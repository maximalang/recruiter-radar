// RBAC Middleware for Next.js API Routes
// Provides authentication and authorization protection

import { NextRequest, NextResponse } from 'next/server';
import { createRBAC, getRBACInstance } from './rbac';
import type { UserRole } from '../../packages/db/schema/init';

export interface RBACOptions {
  requireAuth?: boolean;
  permissions?: string[];
  roles?: UserRole[];
  allowUnauthenticated?: boolean;
}

export function withRBAC(handler: (req: NextRequest, context: any) => Promise<NextResponse>, options: RBACOptions = {}) {
  return async (req: NextRequest, context: any) => {
    const {
      requireAuth = true,
      permissions = [],
      roles = [],
      allowUnauthenticated = false
    } = options;

    // Skip RBAC checks for unauthenticated requests if allowed
    if (!requireAuth && allowUnauthenticated) {
      return handler(req, context);
    }

    // Get user from session (placeholder implementation)
    const user = await getUserFromSession(req);

    // Check authentication
    if (requireAuth && !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Create RBAC instance if user is authenticated
    if (user) {
      const rbac = createRBAC(user.roles || []);

      // Check permissions
      if (permissions.length > 0) {
        const hasPermission = permissions.every(perm => rbac.hasPermission(perm));

        if (!hasPermission) {
          return NextResponse.json(
            { error: `Insufficient permissions. Required: ${permissions.join(', ')}` },
            { status: 403 }
          );
        }
      }

      // Check roles
      if (roles.length > 0) {
        const hasRole = roles.some(role => user.roles?.includes(role));

        if (!hasRole) {
          return NextResponse.json(
            { error: `Access denied. Required role: ${roles.join(', ')}` },
            { status: 403 }
          );
        }
      }
    }

    // Add RBAC context to request
    (req as any).rbac = getRBACInstance();
    (req as any).user = user;

    return handler(req, context);
  };
}

// Simulate getting user from session
async function getUserFromSession(req: NextRequest) {
  // This would normally extract user from session/cookie
  // For now, we'll check for a header that indicates user roles
  const authHeader = req.headers.get('x-user-roles');

  if (!authHeader) {
    return null;
  }

  try {
    const roles = JSON.parse(authHeader) as UserRole[];

    return {
      id: 'current-user-id', // This would come from session
      email: 'current@example.com', // This would come from session
      roles: roles
    };
  } catch (error) {
    console.error('Error parsing user roles:', error);
    return null;
  }
}

// Middleware factory for permission checks
export function requirePermission(permission: string) {
  return withRBAC(
    () => NextResponse.json({ success: true }),
    { permissions: [permission] }
  );
}

// Middleware factory for role checks
export function requireRole(role: UserRole) {
  return withRBAC(
    () => NextResponse.json({ success: true }),
    { roles: [role] }
  );
}

// Route protection decorator
export function Protected(options: RBACOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (req: NextRequest, ...args: any[]) {
      // Apply RBAC middleware
      const response = await withRBAC(
        () => originalMethod.apply(this, [req, ...args]),
        options
      )(req, {});

      if (response.status === 401 || response.status === 403) {
        return response;
      }

      // Continue with original method
      return originalMethod.apply(this, [req, ...args]);
    };

    return descriptor;
  };
}

// Example usage in API route:
/*
export const GET = withRBAC(async (req: NextRequest) => {
  // This route requires authentication
  return NextResponse.json({ message: 'Hello, world!' });
}, { requireAuth: true });

export const POST = withRBAC(async (req: NextRequest) => {
  // This route requires authentication and specific permissions
  const data = await req.json();
  return NextResponse.json({ data });
}, {
  requireAuth: true,
  permissions: ['client_edit', 'client_create']
});
*/