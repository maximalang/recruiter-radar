import { validateAction } from '@/lib/validation-schemas'
import type { BaseAction } from '@/lib/core-types'

describe('Validation System', () => {
  describe('validateAction', () => {
    const mockAction: BaseAction = {
      type: 'TEST_ACTION',
      payload: {
        name: 'Test',
        email: 'test@example.com',
        age: 25,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    }

    it('should pass validation with valid action', () => {
      const rules = {
        name: { required: true, min: 2, max: 50 },
        email: { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        age: { required: false, min: 18, max: 100 },
      }

      const result = validateAction(mockAction, rules)

      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should fail validation for missing required field', () => {
      const rules = {
        name: { required: true },
        email: { required: true },
      }

      const invalidAction = {
        ...mockAction,
        payload: {
          name: '',
          email: 'test@example.com',
        },
      }

      const result = validateAction(invalidAction, rules)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('name is required')
    })

    it('should fail validation for invalid email format', () => {
      const rules = {
        email: { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      }

      const invalidAction = {
        ...mockAction,
        payload: {
          email: 'invalid-email',
        },
      }

      const result = validateAction(invalidAction, rules)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('email must match pattern')
    })

    it('should fail validation for numeric value out of range', () => {
      const rules = {
        age: { required: true, min: 18, max: 100 },
      }

      const invalidAction = {
        ...mockAction,
        payload: {
          age: 15,
        },
      }

      const result = validateAction(invalidAction, rules)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('age must be at least 18')
    })
  })
})