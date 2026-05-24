/**
 * Unit tests for validateAction (the action validator, not the field validator).
 * The actual field-level validation lives in useFormValidation hook.
 * These tests cover the validateAction signature from validation-system.ts.
 */

import { validateAction } from '@/lib/validation/validation-system'

describe('validateAction', () => {
  it('returns valid=true for a well-formed action', () => {
    const action = {
      type: 'TEST_ACTION',
      payload: { name: 'Test' },
      meta: { timestamp: new Date().toISOString() },
    }
    const result = validateAction(action as any)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual({})
    expect(result.error).toBeUndefined()
  })

  it('returns valid=false when type is missing', () => {
    const action = { payload: {} } as any
    const result = validateAction(action)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid action structure')
  })

  it('returns valid=false when type is not a string', () => {
    const action = { type: 123 } as any
    const result = validateAction(action)
    expect(result.valid).toBe(false)
  })

  it('accepts action with no payload or meta', () => {
    const action = { type: 'SIMPLE_ACTION' } as any
    const result = validateAction(action)
    expect(result.valid).toBe(true)
  })

  it('accepts action with nested payload', () => {
    const action = {
      type: 'COMPLEX_ACTION',
      payload: { user: { name: 'Test', age: 25 }, tags: ['a', 'b'] },
    } as any
    const result = validateAction(action)
    expect(result.valid).toBe(true)
  })

  it('returns valid=false when payload is not an object', () => {
    const action = { type: 'BAD', payload: 'string-not-object' } as any
    const result = validateAction(action)
    expect(result.valid).toBe(false)
  })

  it('returns valid=false when meta is not an object', () => {
    const action = { type: 'BAD', meta: 42 } as any
    const result = validateAction(action)
    expect(result.valid).toBe(false)
  })
})
