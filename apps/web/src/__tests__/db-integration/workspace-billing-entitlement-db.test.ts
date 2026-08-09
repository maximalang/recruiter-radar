import { Pool } from "pg";

import { getEffectiveEntitlement } from "@/lib/entitlements";
import { getPool as getSharedPool } from "@/lib/db-pool";
import {
  createCheckoutOrder,
  ensurePaidOrderEntitlement,
  getCheckoutOrderById,
  listCheckoutOrdersForAccess,
} from "@/lib/paymentsRepo";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (process.env.WORKSPACE_BILLING_DB_TEST !== "true" || !databaseUrl) {
  throw new Error(
    "WORKSPACE_BILLING_DB_TEST=true and DATABASE_URL are required for this isolated DB contract.",
  );
}

const database = new Pool({ connectionString: databaseUrl });

describe("workspace billing entitlement ownership", () => {
  afterAll(async () => {
    await getSharedPool()?.end();
    await database.end();
  });

  it("records billing actor B but grants and revokes access for owner A's workspace", async () => {
    const ownerId = await createUser("owner-a");
    const billingActorId = await createUser("billing-b");
    const recruiterId = await createUser("recruiter-c");
    const workspace = await database.query<{ id: string }>(
      `SELECT id::TEXT AS id
       FROM workspaces
       WHERE bootstrap_user_id = $1
       ORDER BY id
       LIMIT 1`,
      [ownerId],
    );
    const workspaceId = workspace.rows[0]?.id;
    expect(workspaceId).toBeDefined();
    const secondaryWorkspace = await database.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug, status)
       VALUES ('Owner secondary', $1, 'active')
       RETURNING id::TEXT AS id`,
      [`owner-secondary-${ownerId}`],
    );
    const secondaryWorkspaceId = secondaryWorkspace.rows[0]?.id;
    expect(secondaryWorkspaceId).toBeDefined();
    await database.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [secondaryWorkspaceId, ownerId],
    );

    await database.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES
         ($1, $2, 'billing', 'active'),
         ($1, $3, 'recruiter', 'active')`,
      [workspaceId, billingActorId, recruiterId],
    );

    const order = await createCheckoutOrder({
      purchasedByUserId: billingActorId,
      workspaceId: workspaceId!,
      entitlementOwnerId: ownerId,
      productCode: "pilot",
      amountMinor: 9900,
      currency: "RUB",
      customerName: "Workspace billing regression",
      customerContact: "billing-b@example.test",
      payload: checkoutPayload(),
    });

    expect(order).toMatchObject({
      purchasedByUserId: billingActorId,
      workspaceId,
      entitlementOwnerId: ownerId,
    });

    await database.query(
      `UPDATE checkout_orders
       SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [order.id],
    );
    const paidOrder = await getCheckoutOrderById(order.id);
    expect(paidOrder?.status).toBe("paid");
    await ensurePaidOrderEntitlement(paidOrder!);

    const ownerAccess = await getEffectiveEntitlement(ownerId, { workspaceId });
    const secondaryWorkspaceAccess = await getEffectiveEntitlement(ownerId, {
      workspaceId: secondaryWorkspaceId,
    });
    const billingActorAccess = await getEffectiveEntitlement(billingActorId, { workspaceId });
    expect(ownerAccess).toMatchObject({ status: "active", source: "payment" });
    expect(secondaryWorkspaceAccess).toMatchObject({ status: "inactive" });
    expect(billingActorAccess.status).toBe("inactive");

    const visibleOrders = await listCheckoutOrdersForAccess({
      workspaceId: workspaceId!,
      entitlementOwnerId: ownerId,
    });
    expect(visibleOrders.map((item) => item.id)).toContain(order.id);

    await database.query(
      `UPDATE checkout_orders
       SET status = 'refunded', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [order.id],
    );

    expect(await getEffectiveEntitlement(ownerId, { workspaceId })).toMatchObject({ status: "inactive" });
    expect(await getEffectiveEntitlement(billingActorId, { workspaceId })).toMatchObject({ status: "inactive" });
  });

  it("uses persisted paid facts and serializes stacking for one workspace owner", async () => {
    const ownerId = await createUser("stack-owner");
    const workspace = await database.query<{ id: string }>(
      `SELECT id::TEXT AS id FROM workspaces WHERE bootstrap_user_id = $1`,
      [ownerId],
    );
    const workspaceId = workspace.rows[0]!.id;

    const unpaid = await createCheckoutOrder({
      purchasedByUserId: ownerId,
      workspaceId,
      entitlementOwnerId: ownerId,
      productCode: "pilot",
      amountMinor: 9900,
      currency: "RUB",
      customerName: "Unpaid forged order",
      customerContact: "unpaid@example.test",
      payload: checkoutPayload(),
    });
    await ensurePaidOrderEntitlement({
      ...unpaid,
      status: "paid",
      productCode: "quarterly",
      paidAt: new Date().toISOString(),
    });
    const forgedGrant = await database.query(
      `SELECT 1 FROM checkout_order_entitlements WHERE order_id = $1`,
      [unpaid.id],
    );
    expect(forgedGrant.rowCount).toBe(0);

    const paidOrders = await Promise.all(["monthly", "quarterly"].map(async (productCode) => {
      const order = await createCheckoutOrder({
        purchasedByUserId: ownerId,
        workspaceId,
        entitlementOwnerId: ownerId,
        productCode: productCode as "monthly" | "quarterly",
        amountMinor: productCode === "monthly" ? 99900 : 249900,
        currency: "RUB",
        customerName: `Concurrent ${productCode}`,
        customerContact: `${productCode}@example.test`,
        payload: checkoutPayload(),
      });
      await database.query(
        `UPDATE checkout_orders
         SET status = 'paid', paid_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [order.id],
      );
      return (await getCheckoutOrderById(order.id))!;
    }));

    await Promise.all(paidOrders.map((order) => ensurePaidOrderEntitlement(order)));
    const windows = await database.query<{
      orderId: string;
      startsAt: Date;
      endsAt: Date;
      durationDays: number;
    }>(
      `SELECT order_id::TEXT AS "orderId", starts_at AS "startsAt",
              ends_at AS "endsAt", duration_days AS "durationDays"
       FROM checkout_order_entitlements
       WHERE workspace_id = $1 AND entitlement_owner_id = $2
       ORDER BY starts_at, order_id`,
      [workspaceId, ownerId],
    );
    expect(windows.rows).toHaveLength(2);
    expect(windows.rows.map((row) => row.durationDays).sort((a, b) => a - b)).toEqual([30, 90]);
    expect(windows.rows[1]!.startsAt.getTime()).toBeGreaterThanOrEqual(windows.rows[0]!.endsAt.getTime());

    await expect(database.query(
      `UPDATE checkout_order_entitlements
       SET user_id = $2
       WHERE order_id = $1`,
      [paidOrders[0]!.id, unpaid.purchasedByUserId === ownerId ? await createUser("wrong-owner") : ownerId],
    )).rejects.toMatchObject({ code: "23514" });
  });
});

async function createUser(prefix: string): Promise<string> {
  const email = `${prefix}-${process.pid}-${Date.now()}@example.test`;
  const result = await database.query<{ id: string }>(
    `INSERT INTO users (email, email_normalized, email_verified_at, status)
     VALUES ($1, $1, CURRENT_TIMESTAMP, 'active')
     RETURNING id::TEXT AS id`,
    [email],
  );
  const userId = result.rows[0]?.id;
  if (!userId) throw new Error(`Failed to create ${prefix} fixture.`);
  await database.query("SELECT ensure_auth_user_workspace($1)", [userId]);
  return userId;
}

function checkoutPayload() {
  return {
    planName: "Пилот",
    planCadence: "7 дней",
    specialization: null,
    city: null,
    includeKeywords: [],
    excludeKeywords: [],
    industries: [],
    companySizes: [],
    dailyDigestLimit: 10,
    roles: [],
    excludedIndustries: [],
    excludedLocations: [],
    remoteFriendly: false,
    comment: null,
    pilotApplicationId: null,
    clientProfileId: null,
    onboardingStatus: "inactive" as const,
    onboardingStep: "confirm-profile" as const,
    onboardingActivatedAt: null,
    onboardingCompletedAt: null,
    onboardingTestDigestSentAt: null,
    onboardingTestDigestTelegramMessageId: null,
    customerDigestLastSentAt: null,
    customerDigestLastEmptyAt: null,
    customerDigestLastFailedAt: null,
    paymentMessage: null,
    paymentProviderPayload: null,
  };
}
