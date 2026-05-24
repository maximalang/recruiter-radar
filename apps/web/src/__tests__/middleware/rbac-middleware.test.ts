import { rbacMiddleware } from '@/lib/rbac-middleware'
import type { BaseAction } from '@/lib/core-types'

describe('rbacMiddleware', () => {
  let mockStore: any
  let mockNext: jest.Mock
  let mockAction: BaseAction

  beforeEach(() => {
    mockStore = {
      getState: jest.fn(),
      dispatch: jest.fn(),
    }
    mockNext = jest.fn()
    mockAction = {
      type: 'TEST_ACTION',
      payload: { test: 'data' },
      meta: {
        timestamp: new Date().toISOString(),
      },
    }
  })

  it('should allow action for user with required permission', () => {
    mockNext.mockReturnValue(mockAction)
    mockStore.getState.mockReturnValue({
      user: {
        permissions: ['read_sources'],
      },
    })

    const result = rbacMiddleware(mockStore)(mockNext)(mockAction)

    expect(mockNext).toHaveBeenCalledWith(mockAction)
    expect(result).toEqual(mockAction)
  })

  it('should dispatch permission error for user without required permission', () => {
    mockNext.mockReturnValue(mockAction)
    mockStore.getState.mockReturnValue({
      user: {
        permissions: [],
      },
    })

    const result = rbacMiddleware(mockStore)(mockNext)(mockAction)

    expect(mockStore.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PERMISSION_ERROR',
      })
    )
  })

  it('should handle role-based permissions', () => {
    mockNext.mockReturnValue(mockAction)
    mockStore.getState.mockReturnValue({
      user: {
        roles: ['admin'],
      },
    })

    const actionWithRole = {
      ...mockAction,
      meta: {
        ...mockAction.meta,
        requiredRoles: ['admin'],
      },
    }

    const result = rbacMiddleware(mockStore)(mockNext)(actionWithRole)

    expect(mockNext).toHaveBeenCalledWith(actionWithRole)
    expect(result).toEqual(mockAction)
  })
})