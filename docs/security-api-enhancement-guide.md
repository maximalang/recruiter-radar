# Security Enhancement Guide for API Routes

This document provides security recommendations for API routes in Recruiter Radar, focusing on protecting against common web vulnerabilities.

## Current Security Status

### Existing Security Measures
- ✅ API key authentication (`x-api-key` header)
- ✅ Input validation in routes
- ✅ SQL injection protection
- ✅ Session management with signed cookies
- ✅ CSRF protection

### Areas for Enhancement
- Rate limiting
- Request size limits
- Additional input sanitization
- Security headers
- Error handling without information leakage

## Recommended Security Enhancements

### 1. Rate Limiting Middleware

Create a rate limiter to prevent brute force attacks and DoS:

```typescript
// apps/web/lib/security/rate-limiter.ts
import { NextRequest } from 'next/server';

export class ApiRateLimiter {
  private requests = new Map<string, number[]>();
  private readonly windowMs = 60 * 1000; // 1 minute
  private readonly maxRequests = 100; // requests per minute

  isAllowed(req: NextRequest): boolean {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let userRequests = this.requests.get(ip) || [];
    userRequests = userRequests.filter(time => time > windowStart);

    if (userRequests.length >= this.maxRequests) {
      return false;
    }

    userRequests.push(now);
    this.requests.set(ip, userRequests);

    return true;
  }

  reset(): void {
    this.requests.clear();
  }
}
```

### 2. Request Size Limits

Prevent large request bodies that could cause memory issues:

```typescript
// apps/web/lib/security/request-limiter.ts
export const MAX_REQUEST_SIZE = {
  JSON: 10 * 1024 * 1024, // 10MB
  FORM: 5 * 1024 * 1024,  // 5MB
  FILE: 50 * 1024 * 1024  // 50MB for file uploads
};

export function validateRequestSize(req: NextRequest, contentType: string): boolean {
  const contentLength = req.headers.get('content-length');
  
  if (!contentLength) return true;

  const size = parseInt(contentLength, 10);
  
  if (contentType.includes('application/json') && size > MAX_REQUEST_SIZE.JSON) {
    return false;
  }
  
  if (contentType.includes('multipart/form-data') && size > MAX_REQUEST_SIZE.FORM) {
    return false;
  }

  return true;
}
```

### 3. Enhanced Input Validation

Create comprehensive input validation:

```typescript
// apps/web/lib/security/input-validator.ts
import { z } from 'zod';

export const CreateDigestSchema = z.object({
  org_id: z.string().min(1).max(255),
  settings: z.object({
    auto_refresh: z.boolean(),
    refresh_interval: z.number().min(1000).max(300000),
    max_items: z.number().min(1).max(1000),
    filters: z.object({
      confidence_gates: z.array(z.enum(['A', 'B', 'C', 'D'])).max(10),
      sources: z.array(z.string()).max(100)
    })
  })
}).strict();

export const ValidateDigestInput = (data: unknown) => {
  try {
    return CreateDigestSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid input: ${error.errors.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
};
```

### 4. Security Headers Middleware

Add security headers to all API responses:

```typescript
// apps/web/lib/security/headers.ts
import { NextResponse } from 'next/server';

export function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Content-Security-Policy', "default-src 'self'");
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  return response;
}

export function setCORSHeaders(response: NextResponse): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  response.headers.set('Access-Control-Max-Age', '86400');
  
  return response;
}
```

### 5. API Key Validation Enhancement

Enhance API key validation with additional checks:

```typescript
// apps/web/lib/security/api-key.ts
import { NextRequest } from 'next/server';

export class ApiKeyValidator {
  private static readonly revokedKeys = new Set<string>();

  static validateKey(req: NextRequest): { isValid: boolean; key?: string } {
    const apiKey = req.headers.get('x-api-key');
    
    if (!apiKey) {
      return { isValid: false };
    }

    // Check if key is revoked
    if (this.revokedKeys.has(apiKey)) {
      return { isValid: false };
    }

    // Validate key format (UUID-like pattern)
    const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    if (!keyPattern.test(apiKey)) {
      return { isValid: false };
    }

    // Additional validation against database
    // ...

    return { isValid: true, key: apiKey };
  }

  static revokeKey(key: string): void {
    this.revokedKeys.add(key);
  }
}
```

### 6. Secure File Upload Handling

```typescript
// apps/web/lib/security/file-upload.ts
import { writeFile } from 'fs/promises';
import { join } from 'path';

export const ALLOWED_FILE_TYPES = {
  images: ['image/jpeg', 'image/png', 'image/gif'],
  documents: ['application/pdf'],
  csv: ['text/csv']
};

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function handleFileUpload(file: File, destination: string): Promise<string> {
  // Validate file type
  const allowedTypes = Object.values(ALLOWED_FILE_TYPES).flat();
  if (!allowedTypes.includes(file.type)) {
    throw new Error('File type not allowed');
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large');
  }

  // Sanitize filename
  const sanitizedFilename = file.name
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .substring(0, 255);

  const filePath = join(destination, sanitizedFilename);

  // Write file
  const bytes = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(bytes));

  return filePath;
}
```

### 7. Error Handling Without Information Leakage

Secure error handling:

```typescript
// apps/web/lib/security/error-handler.ts
import { NextResponse } from 'next/server';

export function createSecureErrorResponse(
  message: string,
  status: number = 400,
  details?: any
): NextResponse {
  // Don't expose sensitive information
  const safeDetails = details ? {
    code: details.code || 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString()
  } : undefined;

  return NextResponse.json({
    success: false,
    error: message,
    ...(safeDetails && { details: safeDetails })
  }, { status });
}

export function logError(error: Error, context?: any): void {
  // Log detailed error for debugging (remove in production)
  console.error('API Error:', {
    error: error.message,
    stack: error.stack,
    context: context || {}
  });
}
```

### 8. API Route Security Middleware

Create a security middleware for all API routes:

```typescript
// apps/web/lib/security/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { ApiRateLimiter } from './rate-limiter';
import { ApiKeyValidator } from './api-key';
import { validateRequestSize } from './request-limiter';
import { addSecurityHeaders } from './headers';

export async function apiSecurityMiddleware(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    // Rate limiting check
    if (!ApiRateLimiter.isAllowed(req)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // API key validation
    const keyValidation = ApiKeyValidator.validateKey(req);
    if (!keyValidation.isValid) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    // Request size validation
    const contentType = req.headers.get('content-type') || '';
    if (!validateRequestSize(req, contentType)) {
      return NextResponse.json(
        { error: 'Request too large' },
        { status: 413 }
      );
    }

    // Continue with request handler
    const response = await handler(req);
    
    // Add security headers
    return addSecurityHeaders(response);
  } catch (error) {
    console.error('Security middleware error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## Implementation Recommendations

### Phase 1: Critical Security Enhancements (High Priority)
1. Implement rate limiting
2. Add request size limits
3. Enhance API key validation
4. Add security headers

### Phase 2: Input Validation Improvements (Medium Priority)
1. Implement Zod validation schemas
2. Add file upload security
3. Enhanced error handling

### Phase 3: Advanced Security Features (Low Priority)
1. API versioning
2. Request signing
3. Rate limiting per endpoint
4. Rate limiting per user

## Monitoring and Auditing

### Security Metrics to Monitor
1. Rate limit hits
2. Failed authentication attempts
3. Request size violations
4. Invalid input attempts
5. Security header compliance

### Log Security Events
```typescript
// Example security logging
export function logSecurityEvent(event: {
  type: string;
  severity: 'info' | 'warning' | 'error';
  details: any;
  timestamp: Date;
}): void {
  // Send to secure logging service
  console.log('[Security Event]', {
    ...event,
    timestamp: event.timestamp.toISOString()
  });
}
```

## Testing Security Enhancements

### Security Tests
1. Rate limiting test
2. Input validation test
3. Security headers test
4. API key validation test
5. Error information leakage test

### Penetration Testing Checklist
- [ ] Brute force attacks on API endpoints
- [ ] SQL injection attempts
- [ ] XSS attacks
- [ ] CSRF attacks
- [ ] Large request payloads
- [ ] Invalid input handling
- [ ] Security header bypass attempts

## Conclusion

Implementing these security enhancements will significantly improve the security posture of the API routes in Recruiter Radar. Start with Phase 1 enhancements first, as they provide the most security benefit with minimal implementation complexity.