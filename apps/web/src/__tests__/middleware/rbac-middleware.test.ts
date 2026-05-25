/**
 * Tests for RBAC middleware and helpers
 * Tests withRBAC route wrapper and permission checking utilities
 */

describe('withRBAC middleware', () => {
  const { withRBAC } = require('../../../lib/rbac-middleware');

  it('allows request without auth when allowUnauthenticated is true', async () => {
    const handler = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const middleware = withRBAC(handler, { requireAuth: false, allowUnauthenticated: true });

    const req = new Request('http://localhost/');
    const result = await middleware(req, {});

    expect(result.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('rejects request without auth when requireAuth is true', async () => {
    const handler = jest.fn();
    const middleware = withRBAC(handler, { requireAuth: true });

    const req = new Request('http://localhost/');
    const result = await middleware(req, {});

    expect(result.status).toBe(401);
    expect(result.headers.get('content-type')).toBe('application/json');
  });

  it('accepts request with valid roles', async () => {
    const handler = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const middleware = withRBAC(handler, { roles: ['agency_admin'] });

    const req = new Request('http://localhost/', {
      headers: { 'x-user-roles': JSON.stringify(['agency_admin']) }
    });
    const result = await middleware(req, {});

    expect(result.status).toBe(200);
  });

  it('rejects request with insufficient role', async () => {
    const handler = jest.fn();
    // Use 'viewer' role but require 'super_admin' which viewer doesn't have
    const middleware = withRBAC(handler, { roles: ['super_admin'] });

    const req = new Request('http://localhost/', {
      headers: { 'x-user-roles': JSON.stringify(['viewer']) }
    });
    const result = await middleware(req, {});

    expect(result.status).toBe(403);
    const body = await result.json();
    expect(body.error).toContain('Access denied');
  });

  it('passes user context to handler', async () => {
    let receivedUser = null;
    const handler = jest.fn().mockImplementation((req) => {
      receivedUser = (req as any).user;
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });
    const middleware = withRBAC(handler, { requireAuth: true });

    const req = new Request('http://localhost/', {
      headers: { 'x-user-roles': JSON.stringify(['recruiter']) }
    });
    await middleware(req, {});

    expect(receivedUser).not.toBeNull();
    expect(receivedUser.roles).toContain('recruiter');
  });

  it('returns 401 for missing auth header when requireAuth is true', async () => {
    const handler = jest.fn();
    const middleware = withRBAC(handler, { requireAuth: true });

    const req = new Request('http://localhost/');
    const result = await middleware(req, {});

    expect(result.status).toBe(401);
  });

  it('handles invalid roles header gracefully', async () => {
    const handler = jest.fn();
    const middleware = withRBAC(handler, { roles: ['admin'] });

    const req = new Request('http://localhost/', {
      headers: { 'x-user-roles': 'not-valid-json' }
    });
    const result = await middleware(req, {});

    // Should treat invalid JSON as unauthenticated
    expect(result.status).toBe(401);
  });
});