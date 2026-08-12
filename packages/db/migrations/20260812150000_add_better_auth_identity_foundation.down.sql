-- Safe only while the Better Auth rollout remains dark. This intentionally
-- refuses CASCADE so unexpected dependants block rollback instead of being lost.

DROP TABLE IF EXISTS public.better_auth_identity_links;

SET LOCAL search_path = better_auth, public;

DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "rateLimit";
DROP TABLE IF EXISTS "user";

SET LOCAL search_path = public;
DROP SCHEMA IF EXISTS better_auth;
