BEGIN;

-- Create role types
CREATE TYPE user_role AS ENUM (
  'super_admin',
  'agency_admin',
  'recruiter',
  'viewer'
);

-- Create permission types
CREATE TYPE permission_type AS ENUM (
  'dashboard_view',
  'dashboard_edit',
  'digest_view',
  'digest_edit',
  'client_edit',
  'client_create',
  'client_delete',
  'source_config',
  'user_management',
  'system_admin',
  'billing_view',
  'billing_edit'
);

-- Create roles table
CREATE TABLE roles (
  id BIGSERIAL PRIMARY KEY,
  name user_role NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roles_name_unique UNIQUE (name)
);

-- Insert default roles
INSERT INTO roles (name, description) VALUES
  ('super_admin', 'System super administrator with full access'),
  ('agency_admin', 'Agency administrator with full access to agency resources'),
  ('recruiter', 'Recruiter with access to digest and client profiles'),
  ('viewer', 'Read-only access to digests and reports');

-- Create permissions table
CREATE TABLE permissions (
  id BIGSERIAL PRIMARY KEY,
  name permission_type NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_name_unique UNIQUE (name)
);

-- Insert default permissions
INSERT INTO permissions (name, description) VALUES
  ('dashboard_view', 'View dashboard and analytics'),
  ('dashboard_edit', 'Edit dashboard configuration'),
  ('digest_view', 'View digest results'),
  ('digest_edit', 'Edit digest settings and filters'),
  ('client_edit', 'Edit client profiles'),
  ('client_create', 'Create new client profiles'),
  ('client_delete', 'Delete client profiles'),
  ('source_config', 'Configure data sources'),
  ('user_management', 'Manage users and roles'),
  ('system_admin', 'System administration'),
  ('billing_view', 'View billing information'),
  ('billing_edit', 'Edit billing settings');

-- Create role_permissions junction table
CREATE TABLE role_permissions (
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

-- Create user_roles table for assigning roles to users
CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role_id)
);

-- Create audit_log table for tracking actions
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_logs_action_not_blank CHECK (BTRIM(action) <> ''),
  CONSTRAINT audit_logs_resource_type_check
    CHECK (resource_type IS NULL OR BTRIM(resource_type) <> '')
);

-- Create indexes for performance
CREATE INDEX audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX audit_logs_action_idx ON audit_logs(action);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);

-- Insert default role permissions
-- Super Admin: All permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'super_admin';

-- Agency Admin: Most permissions except system_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'agency_admin'
  AND p.name != 'system_admin';

-- Recruiter: Basic permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'recruiter'
  AND p.name IN (
    'dashboard_view',
    'digest_view',
    'digest_edit',
    'client_edit'
  );

-- Viewer: Read-only permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'viewer'
  AND p.name IN (
    'dashboard_view',
    'digest_view'
  );

COMMIT;