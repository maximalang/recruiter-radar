import { validationMiddleware } from '@/lib/validation-middleware'
import type { BaseAction } from '@/lib/core-types'

describe('validationMiddleware', () => {
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

  it('should pass validation for valid action', () => {
    mockNext.mockReturnValue(mockAction)

    const result = validationMiddleware(mockStore)(mockNext)(mockAction)

    expect(mockNext).toHaveBeenCalledWith(mockAction)
    expect(result).toEqual(mockAction)
  })

  it('should dispatch validation error for invalid action', () => {
    mockNext.mockImplementation((action: BaseAction) => {
      if (action.type === 'VALIDATION_ERROR') {
        return action
      }
      return mockAction
    })

    const invalidAction = {
      ...mockAction,
      payload: null, // Invalid payload
    }

    const result = validationMiddleware(mockStore)(mockNext)(invalidAction)

    expect(mockStore.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'VALIDATION_ERROR',
      })
    )
  })

  it('should handle validation rules', () => {
    const actionWithRules = {
      ...mockAction,
      meta: {
        ...mockAction.meta,
        validation: {
          required: ['test'],
        },
      },
    }

    mockNext.mockReturnValue(mockAction)

    const result = validationMiddleware(mockStore)(mockNext)(actionWithRules)

    expect(mockNext).toHaveBeenCalledWith(actionWithRules)
    expect(result).toEqual(mockAction)
  })
})