import type { PoolClient } from "pg";

export const AUTH_OWNER_WRITE_FENCE_KEY = "auth-owner-scoped-writes";

type AuthOwnerWriteFenceClient = Pick<PoolClient, "query">;

export async function acquireAuthOwnerWriteFence(
  client: AuthOwnerWriteFenceClient,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
    [AUTH_OWNER_WRITE_FENCE_KEY],
  );
}

export async function acquireAuthOwnerDeletionFence(
  client: AuthOwnerWriteFenceClient,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [AUTH_OWNER_WRITE_FENCE_KEY],
  );
}
