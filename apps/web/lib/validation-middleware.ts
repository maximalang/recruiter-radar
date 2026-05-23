// Unified validation middleware using the new validation system
import { validationMiddleware as unifiedValidationMiddleware } from './validation/validation-system';

// Re-export the unified validation middleware
export { validationMiddleware } from './validation/validation-system';

// For backward compatibility, keep the old name
export default unifiedValidationMiddleware;