/**
 * Environment variable validation for production deployment.
 * Fails fast with clear error messages if required secrets are missing.
 */

interface ValidationError {
  variable: string;
  message: string;
}

const REQUIRED_SECRET_VARS = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'TELEGRAM_BOT_TOKEN',
] as const;

const REQUIRED_CONFIG_VARS = [
  'NEXT_PUBLIC_APP_URL',
] as const;

type SecretVar = typeof REQUIRED_SECRET_VARS[number];
type ConfigVar = typeof REQUIRED_CONFIG_VARS[number];

function validateSecretVars(): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const varName of REQUIRED_SECRET_VARS) {
    const value = process.env[varName];
    if (!value) {
      errors.push({
        variable: varName,
        message: `${varName} is required. Set it in environment variables.`,
      });
    } else if (varName === 'SESSION_SECRET' && value.length < 32) {
      errors.push({
        variable: varName,
        message: `${varName} must be at least 32 characters long for security.`,
      });
    }
  }

  return errors;
}

function validateConfigVars(): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const varName of REQUIRED_CONFIG_VARS) {
    const value = process.env[varName];
    if (!value) {
      errors.push({
        variable: varName,
        message: `${varName} is required. Set it in environment variables.`,
      });
    }
  }

  return errors;
}

function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => `  - ${e.variable}: ${e.message}`)
    .join('\n');
}

/**
 * Validates all required environment variables.
 * Call this at application startup.
 *
 * @throws {Error} If any required variables are missing
 */
export function validateEnv(): void {
  // Skip validation in development if DATABASE_URL is not set
  if (process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL) {
    console.warn('⚠️  Skipping env validation in development (DATABASE_URL not set)');
    return;
  }

  const secretErrors = validateSecretVars();
  const configErrors = validateConfigVars();
  const allErrors = [...secretErrors, ...configErrors];

  if (allErrors.length > 0) {
    const errorMessage = [
      '❌ Environment validation failed:',
      formatErrors(allErrors),
      '',
      'Please set these environment variables before starting the application.',
    ].join('\n');

    throw new Error(errorMessage);
  }

  console.log('✅ Environment validation passed');
}

// For testing
export const _testing = {
  validateSecretVars,
  validateConfigVars,
};