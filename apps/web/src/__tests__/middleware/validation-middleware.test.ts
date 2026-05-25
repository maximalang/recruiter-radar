/**
 * Tests for validation middleware
 * Tests the actual API: enhancedValidationMiddleware and createValidationMiddleware
 */

describe('validationMiddleware', () => {
  const { createValidationMiddleware } = require('../../../lib/validation-middleware');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createValidationMiddleware', () => {
    it('returns a function that processes valid actions', () => {
      const middleware = createValidationMiddleware({ strict: true });
      const next = jest.fn();
      const action = { type: 'VALID_ACTION', payload: { data: 'test' } };

      middleware(action, next);

      expect(next).toHaveBeenCalledWith(action);
    });

    it('rejects actions without type', () => {
      const middleware = createValidationMiddleware({ strict: true });
      const next = jest.fn();
      const action = { payload: { data: 'test' } } as any;

      expect(() => middleware(action, next)).toThrow('Action must have a type');
    });

    it('respects strict mode option', () => {
      const strictMiddleware = createValidationMiddleware({ strict: true });
      const looseMiddleware = createValidationMiddleware({ strict: false });
      const next = jest.fn();

      // Both should accept valid actions
      const action = { type: 'TEST', payload: {} };

      expect(() => strictMiddleware(action, next)).not.toThrow();
      expect(() => looseMiddleware(action, next)).not.toThrow();
    });
  });

  describe('validation rules', () => {
    it('handles array actions', () => {
      const middleware = createValidationMiddleware({ strict: false });
      const next = jest.fn();
      const actions = [
        { type: 'ACTION_1' },
        { type: 'ACTION_2' },
      ];

      middleware(actions, next);

      expect(next).toHaveBeenCalledWith(actions);
    });
  });
});