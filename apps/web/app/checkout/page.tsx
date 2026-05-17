import Link from "next/link";
import { redirect } from "next/navigation";

import { startCheckoutOrder } from "../../lib/payments";
import { buildCheckoutHref, readPublicPreviewInput } from "../../lib/publicProduct";
import { generateOwnerId, readOwnerSession, writeOwnerSession } from "../../lib/session";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const input = readPublicPreviewInput(searchParams);
  const restartHref = buildCheckoutHref(input);

  // Read existing session — do NOT fall back to CHECKOUT_DEFAULT_OWNER_ID for public customers.
  const existingOwnerId = await readOwnerSession();

  async function startCheckoutAction() {
    "use server";

    // Resolve or mint a per-visitor owner ID inside the action (write path only).
    let ownerId = await readOwnerSession();

    if (!ownerId) {
      ownerId = generateOwnerId();
    }

    const result = await startCheckoutOrder({
      userId: ownerId,
      productCode: "pilot",
      customerName: "Self-serve pilot checkout",
      customerContact: "checkout@recruiter-radar.local",
      specialization: input.specialization || null,
      city: input.targetCity || null,
      includeKeywords: input.includeKeywords || null,
      excludeKeywords: input.excludeKeywords || null,
      dailyDigestLimit: input.dailyDigestLimit,
      siteUrl: process.env.PAYMENTS_SITE_URL ?? "http://localhost:3000"
    });

    await writeOwnerSession(ownerId);
    redirect(result.redirectUrl);
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "Inter, sans-serif" }}>
      <h1>Checkout</h1>
      <p>Оплата запускается только после явного подтверждения.</p>
      {!existingOwnerId ? <p>Нажмите кнопку ниже, чтобы запустить пилот.</p> : null}
      <form action={startCheckoutAction}>
        <button type="submit">Перейти к оплате</button>
      </form>
      <p><Link href={restartHref}>Обновить параметры пилота</Link></p>
    </main>
  );
}
