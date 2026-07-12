BEGIN;

-- Drop the unused RBAC schema added in 20260521010000_add_rbac_tables.sql.
--
-- That migration created a role-based access-control layer (roles, permissions,
-- role_permissions, user_roles, the user_role/permission_type enums) plus an
-- audit_logs table. None of it was ever wired into the application: zero code
-- references to these tables or enum types exist in apps/web or packages/db
-- (verified by repo-wide grep), no column outside the RBAC tables themselves
-- uses the enums, and access control is enforced at the session/owner boundary
-- (lib/session, lib/operator-auth) — not via these tables. The seeded role/
-- permission rows are boilerplate from the migration, not real data.
--
-- Drop order respects FK dependencies: junction tables first (user_roles,
-- role_permissions reference roles/permissions), then the parent tables
-- (roles, permissions, audit_logs), then the enum types. Everything is
-- IF EXISTS so the migration is idempotent and safe on databases that never
-- had the RBAC migration applied.
--
-- NOTE: audit_logs is dropped here too. It was introduced as part of the same
-- RBAC migration and is likewise unreferenced. If action auditing is needed
-- later it should be reintroduced as a dedicated migration with a concrete
-- writer, not revived from this orphaned shape.

DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS audit_logs;

DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS permission_type;

COMMIT;
