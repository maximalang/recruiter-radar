-- Better Auth 1.6.25 website-identity schema, isolated from Recruiter Radar's
-- existing public users/session tables. Generated with:
-- npx auth@1.6.25 generate --config apps/web/lib/better-auth/auth.ts
-- OAuth Provider tables are intentionally absent.

CREATE SCHEMA IF NOT EXISTS better_auth;
SET LOCAL search_path = better_auth, public;

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- Product data keeps its existing BIGINT user IDs. This bridge is the only
-- identity coupling and makes the Better Auth rollout reversible without
-- rewriting tenant, billing, lead or opportunity ownership.
SET LOCAL search_path = public;

CREATE TABLE better_auth_identity_links (
  auth_user_id TEXT PRIMARY KEY,
  product_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT better_auth_identity_links_auth_user_fk
    FOREIGN KEY (auth_user_id)
    REFERENCES better_auth."user"("id")
    ON DELETE CASCADE,
  CONSTRAINT better_auth_identity_links_auth_user_id_nonempty
    CHECK (length(btrim(auth_user_id)) > 0)
);
