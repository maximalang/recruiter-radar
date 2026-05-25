import {
  validateEnv,
  _testing,
} from '../../lib/env-validation';

const { validateSecretVars, validateConfigVars } = _testing;

describe('env-validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('validateSecretVars', () => {
    it('returns empty array when all required secrets are present', () => {
      process.env.DATABASE_URL = 'postgres://localhost/db';
      process.env.SESSION_SECRET = 'a'.repeat(32);

      const errors = validateSecretVars();
      expect(errors).toHaveLength(0);
    });

    it('returns error when DATABASE_URL is missing', () => {
      delete process.env.DATABASE_URL;
      process.env.SESSION_SECRET = 'a'.repeat(32);

      const errors = validateSecretVars();
      expect(errors).toContainEqual(
        expect.objectContaining({
          variable: 'DATABASE_URL',
          message: expect.stringContaining('required'),
        })
      );
    });

    it('returns error when SESSION_SECRET is missing', () => {
      process.env.DATABASE_URL = 'postgres://localhost/db';
      delete process.env.SESSION_SECRET;

      const errors = validateSecretVars();
      expect(errors).toContainEqual(
        expect.objectContaining({
          variable: 'SESSION_SECRET',
          message: expect.stringContaining('required'),
        })
      );
    });

    it('returns error when SESSION_SECRET is too short', () => {
      process.env.DATABASE_URL = 'postgres://localhost/db';
      process.env.SESSION_SECRET = 'short';

      const errors = validateSecretVars();
      expect(errors).toContainEqual(
        expect.objectContaining({
          variable: 'SESSION_SECRET',
          message: expect.stringContaining('32 characters'),
        })
      );
    });
  });

  describe('validateConfigVars', () => {
    it('returns empty array when all required config vars are present', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

      const errors = validateConfigVars();
      expect(errors).toHaveLength(0);
    });

    it('returns error when NEXT_PUBLIC_APP_URL is missing', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const errors = validateConfigVars();
      expect(errors).toContainEqual(
        expect.objectContaining({
          variable: 'NEXT_PUBLIC_APP_URL',
        })
      );
    });
  });

  describe('validateEnv', () => {
    it('skips validation in development without DATABASE_URL', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_URL;
      delete process.env.SESSION_SECRET;

      // Should not throw
      expect(() => validateEnv()).not.toThrow();
    });

    it('throws error with formatted messages when vars missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      delete process.env.SESSION_SECRET;
      delete process.env.NEXT_PUBLIC_APP_URL;

      expect(() => validateEnv()).toThrow(/Environment validation failed/);
    });
  });
});