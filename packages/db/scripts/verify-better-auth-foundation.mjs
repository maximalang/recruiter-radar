import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

if (process.env.BETTER_AUTH_DB_CONTRACT_ALLOW !== "1") {
  throw new Error("Refusing Better Auth DB contract run without BETTER_AUTH_DB_CONTRACT_ALLOW=1.");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const expectedTables = [
  "user",
  "session",
  "account",
  "verification",
  "jwks",
  "oauthClient",
  "oauthRefreshToken",
  "oauthAccessToken",
  "oauthConsent",
  "rateLimit",
];

const client = new Client({ connectionString: databaseUrl });
await client.connect();

async function scalar(sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0]?.value;
}

try {
  const schemas = await client.query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE (table_schema = 'better_auth' AND table_name = ANY($1::text[]))
         OR (table_schema = 'public' AND table_name = ANY($1::text[]))`,
    [expectedTables],
  );
  const betterAuthTables = new Set(
    schemas.rows
      .filter((row) => row.table_schema === "better_auth")
      .map((row) => row.table_name),
  );
  const leakedPublicTables = schemas.rows
    .filter((row) => row.table_schema === "public")
    .map((row) => row.table_name);

  for (const table of expectedTables) {
    if (!betterAuthTables.has(table)) {
      throw new Error(`Missing better_auth.${table}.`);
    }
  }
  if (leakedPublicTables.length > 0) {
    throw new Error(`Better Auth tables leaked into public schema: ${leakedPublicTables.join(", ")}`);
  }

  if ((await scalar("SELECT to_regclass('public.users')::text AS value")) !== "users") {
    throw new Error("Existing public.users table is missing.");
  }
  if ((await scalar("SELECT to_regclass('public.better_auth_identity_links')::text AS value")) !== "better_auth_identity_links") {
    throw new Error("Identity bridge table is missing.");
  }

  await client.query("BEGIN");
  const product = await client.query(
    `INSERT INTO public.users (email)
     VALUES ($1)
     RETURNING id::text AS id`,
    [`better-auth-contract-${Date.now()}@example.invalid`],
  );
  const productUserId = product.rows[0].id;

  await client.query(
    `INSERT INTO better_auth."user"
      ("id", "name", "email", "emailVerified", "updatedAt")
     VALUES ($1, $2, $3, TRUE, NOW())`,
    ["ba_contract_one", "Contract One", `ba-contract-one-${Date.now()}@example.invalid`],
  );
  await client.query(
    `INSERT INTO public.better_auth_identity_links (auth_user_id, product_user_id)
     VALUES ($1, $2)`,
    ["ba_contract_one", productUserId],
  );

  await client.query(
    `INSERT INTO better_auth."user"
      ("id", "name", "email", "emailVerified", "updatedAt")
     VALUES ($1, $2, $3, TRUE, NOW())`,
    ["ba_contract_two", "Contract Two", `ba-contract-two-${Date.now()}@example.invalid`],
  );

  await client.query("SAVEPOINT duplicate_bridge");
  let duplicateRejected = false;
  try {
    await client.query(
      `INSERT INTO public.better_auth_identity_links (auth_user_id, product_user_id)
       VALUES ($1, $2)`,
      ["ba_contract_two", productUserId],
    );
  } catch (error) {
    duplicateRejected = error?.code === "23505";
    await client.query("ROLLBACK TO SAVEPOINT duplicate_bridge");
  }
  if (!duplicateRejected) throw new Error("Bridge did not enforce one-to-one product identity.");

  await client.query(`DELETE FROM better_auth."user" WHERE "id" = $1`, ["ba_contract_one"]);
  const bridgeCount = Number(await scalar(
    "SELECT COUNT(*)::int AS value FROM public.better_auth_identity_links WHERE product_user_id = $1",
    [productUserId],
  ));
  const productCount = Number(await scalar(
    "SELECT COUNT(*)::int AS value FROM public.users WHERE id = $1",
    [productUserId],
  ));
  if (bridgeCount !== 0) throw new Error("Deleting Better Auth identity did not cascade its bridge row.");
  if (productCount !== 1) throw new Error("Deleting Better Auth identity deleted the product user.");
  await client.query("ROLLBACK");

  const downPath = fileURLToPath(
    new URL("../migrations/20260812150000_add_better_auth_identity_foundation.down.sql", import.meta.url),
  );
  const downSql = await readFile(downPath, "utf8");
  await client.query("BEGIN");
  await client.query(downSql);
  if ((await scalar("SELECT to_regnamespace('better_auth')::text AS value")) !== null) {
    throw new Error("Down migration did not remove better_auth schema.");
  }
  if ((await scalar("SELECT to_regclass('public.users')::text AS value")) !== "users") {
    throw new Error("Down migration damaged public.users.");
  }
  await client.query("ROLLBACK");

  console.log("Better Auth foundation DB contract: PASS");
} finally {
  await client.end();
}
