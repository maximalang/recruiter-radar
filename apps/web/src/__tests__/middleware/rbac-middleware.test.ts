/**
 * Tests for RBAC middleware — T3.1
 *
 * Now uses readOwnerSession() from session.ts instead of x-user-roles header.
 * Auth comes from signed HMAC cookie, not from a spoofable header.
 */

// Mock readOwnerSession to control auth state
let mockSessionOwnerId: string | null = null
jest.mock('../../../lib/session', () => ({
  readOwnerSession: jest.fn().mockImplementation(() => Promise.resolve(mockSessionOwnerId)),
}))

describe('withRBAC middleware', () => {
  const { withRBAC } = require('../../../lib/rbac-middleware')

  beforeEach(() => {
    mockSessionOwnerId = null
  })

  it('allows request without auth when allowUnauthenticated is true', async () => {
    const handler = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const middleware = withRBAC(handler, { requireAuth: false, allowUnauthenticated: true })

    const req = new Request('http://localhost/')
    const result = await middleware(req, {})

    expect(result.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('rejects request without session when requireAuth is true', async () => {
    mockSessionOwnerId = null // No session
    const handler = jest.fn()
    const middleware = withRBAC(handler, { requireAuth: true })

    const req = new Request('http://localhost/')
    const result = await middleware(req, {})

    expect(result.status).toBe(401)
    expect(result.headers.get('content-type')).toBe('application/json')
  })

  it('accepts request with valid session (owner role)', async () => {
    mockSessionOwnerId = 'owner-123' // Valid session
    const handler = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const middleware = withRBAC(handler, { roles: ['owner'] })

    const req = new Request('http://localhost/')
    const result = await middleware(req, {})

    expect(result.status).toBe(200)
  })

  it('rejects request when session user lacks required role', async () => {
    mockSessionOwnerId = 'owner-123' // Valid session → gets 'owner' role
    const handler = jest.fn()
    const middleware = withRBAC(handler, { roles: ['super_admin'] })

    const req = new Request('http://localhost/')
    const result = await middleware(req, {})

    expect(result.status).toBe(403)
    const body = await result.json()
    expect(body.error).toContain('Access denied')
  })

  it('passes user context to handler from session', async () => {
    mockSessionOwnerId = 'owner-456'
    let receivedUser = null
    const handler = jest.fn().mockImplementation((req) => {
      receivedUser = (req as any).user
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
    })
    const middleware = withRBAC(handler, { requireAuth: true })

    const req = new Request('http://localhost/')
    await middleware(req, {})

    expect(receivedUser).not.toBeNull()
    expect(receivedUser.id).toBe('owner-456')
    expect(receivedUser.roles).toContain('owner')
  })

  it('ignores x-user-roles header (not used for auth)', async () => {
    mockSessionOwnerId = null // No session
    const handler = jest.fn()
    const middleware = withRBAC(handler, { requireAuth: true })

    // Even with x-user-roles header, no session = 401
    const req = new Request('http://localhost/', {
      headers: { 'x-user-roles': JSON.stringify(['admin']) }
    })
    const result = await middleware(req, {})

    expect(result.status).toBe(401)
  })

  it('x-user-roles header does not override session roles', async () => {
    mockSessionOwnerId = 'owner-789' // Valid session → 'owner' role
    const handler = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    const middleware = withRBAC(handler, { roles: ['owner'] })

    // Header says 'super_admin' but session gives 'owner'
    const req = new Request('http://localhost/', {
      headers: { 'x-user-roles': JSON.stringify(['super_admin']) }
    })
    const result = await middleware(req, {})

    expect(result.status).toBe(200) // Passes because session has 'owner'
  })
})
