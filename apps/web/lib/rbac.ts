// Role-Based Access Control (RBAC) Implementation
// Provides authorization middleware and permission checking

import type { UserRole } from './user-types';

export type Permission = string;

export interface PermissionCheck {
  hasPermission(permission: Permission): boolean;
  hasAnyPermission(permissions: Permission[]): boolean;
  hasAllPermissions(permissions: Permission[]): boolean;
  getRole(): UserRole | null;
}

export class RBACService {
  private userRoles: UserRole[] = [];
  private permissions: Permission[] = [];

  constructor(userRoles: UserRole[] = []) {
    this.userRoles = userRoles;
    this.permissions = this.getPermissionsForRoles(userRoles);
  }

  private getPermissionsForRoles(roles: UserRole[]): Permission[] {
    // This would normally be fetched from the database
    // For now, we'll use a hardcoded mapping
    const rolePermissions: Record<UserRole, Permission[]> = {
      super_admin: [
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
      ],
      owner: [
        'dashboard_view',
        'dashboard_edit',
        'digest_view',
        'digest_edit',
        'client_edit',
        'client_create',
        'client_delete',
        'source_config',
        'billing_view',
        'billing_edit'
      ],
      agency_admin: [
        'dashboard_view',
        'dashboard_edit',
        'digest_view',
        'digest_edit',
        'client_edit',
        'client_create',
        'client_delete',
        'source_config',
        'billing_view',
        'billing_edit'
      ],
      recruiter: [
        'dashboard_view',
        'digest_view',
        'digest_edit',
        'client_edit'
      ],
      viewer: [
        'dashboard_view',
        'digest_view'
      ]
    };

    const permissions = new Set<Permission>();

    roles.forEach(role => {
      rolePermissions[role].forEach(permission => {
        permissions.add(permission);
      });
    });

    return Array.from(permissions);
  }

  hasPermission(permission: Permission): boolean {
    return this.permissions.includes(permission);
  }

  hasAnyPermission(permissions: Permission[]): boolean {
    return permissions.some(permission => this.permissions.includes(permission));
  }

  hasAllPermissions(permissions: Permission[]): boolean {
    return permissions.every(permission => this.permissions.includes(permission));
  }

  getRole(): UserRole | null {
    return this.userRoles.length > 0 ? this.userRoles[0] : null;
  }

  isSuperAdmin(): boolean {
    return this.userRoles.includes('super_admin');
  }

  isAdmin(): boolean {
    return this.userRoles.includes('super_admin') || this.userRoles.includes('agency_admin');
  }

  canManageUsers(): boolean {
    return this.hasPermission('user_management') || this.isSuperAdmin();
  }

  canManageClients(): boolean {
    return this.hasAnyPermission(['client_edit', 'client_create', 'client_delete']);
  }

  canViewDigest(): boolean {
    return this.hasPermission('digest_view');
  }

  canEditDigest(): boolean {
    return this.hasPermission('digest_edit');
  }
}

// Global RBAC instance
let globalRBAC: RBACService | null = null;

export function setRBACInstance(rbac: RBACService): void {
  globalRBAC = rbac;
}

export function getRBACInstance(): RBACService | null {
  return globalRBAC;
}

// Create RBAC instance from user roles
export function createRBAC(roles: UserRole[]): RBACService {
  const rbac = new RBACService(roles);
  setRBACInstance(rbac);
  return rbac;
}

// Middleware for permission checking
export function requirePermission(permission: Permission) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const rbac = getRBACInstance();

      if (!rbac) {
        throw new Error('RBAC not initialized');
      }

      if (!rbac.hasPermission(permission)) {
        throw new Error(`Permission denied: ${permission} required`);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

// Higher-order function for permission checking
export function withPermission(permission: Permission, fn: Function) {
  return (...args: any[]) => {
    const rbac = getRBACInstance();

    if (!rbac) {
      throw new Error('RBAC not initialized');
    }

    if (!rbac.hasPermission(permission)) {
      throw new Error(`Permission denied: ${permission} required`);
    }

    return fn(...args);
  };
}

// Permission check helper
export function checkPermission(permission: Permission): boolean {
  const rbac = getRBACInstance();
  return rbac ? rbac.hasPermission(permission) : false;
}

// Get current user's permissions
export function getCurrentPermissions(): Permission[] {
  const rbac = getRBACInstance();
  return rbac ? (rbac as any).permissions : [];
}

// Get current user's roles
export function getCurrentRoles(): UserRole[] {
  const rbac = getRBACInstance();
  return rbac ? (rbac as any).userRoles : [];
}

// Check if user has role
export function hasRole(role: UserRole): boolean {
  const rbac = getRBACInstance();
  return rbac ? (rbac as any).userRoles.includes(role) : false;
}

// Audit log helper
export function logAction(action: string, resourceType?: string, resourceId?: string, oldValues?: any, newValues?: any) {
  // This would normally save to the audit_logs table
  console.log('Audit Log:', {
    action,
    resourceType,
    resourceId,
    oldValues,
    newValues,
    timestamp: new Date().toISOString(),
    userId: getCurrentUserId() // This would be obtained from the session
  });
}

// Helper function to get current user ID (placeholder)
function getCurrentUserId(): string | null {
  // This would be implemented based on your authentication system
  return null;
}