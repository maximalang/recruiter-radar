/**
 * Skipped: rbacMiddleware does not exist in the codebase.
 * The codebase exposes `withRBAC` (a route wrapper) and `requirePermission` /
 * `requireRole` decorators. The old Redux-style `rbacMiddleware(store)(next)(action)`
 * curried signature is not implemented.
 *
 * Skipped rather than deleted per plan rule: "do not remove existing tests".
 */
describe.skip('rbacMiddleware', () => {
  it('should allow action for user with required permission', () => {})
  it('should dispatch permission error for user without required permission', () => {})
  it('should handle role-based permissions', () => {})
})