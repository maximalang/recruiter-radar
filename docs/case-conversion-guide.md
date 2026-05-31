# Case Conversion Guide for Recruiter Radar

This document explains how to handle compatibility between camelCase (frontend) and snake_case (backend/database) naming conventions in Recruiter Radar.

## Overview

The application uses different naming conventions in different layers:
- **Frontend**: camelCase (TypeScript, React, JavaScript)
- **Backend/API**: snake_case (Python, PostgreSQL)
- **Database**: snake_case (PostgreSQL conventions)

This guide provides utilities and patterns to handle case conversion automatically.

## Naming Convention Standards

### Frontend (camelCase)
```typescript
interface UserProfile {
  id: string;
  companyId: string;
  companyName: string;
  createdAt: string;
  isActive: boolean;
}

// Component props
function UserCard({ companyId, isActive }: UserCardProps) {
  // ...
}
```

### Backend/API (snake_case)
```python
# API Response
{
  "id": "123",
  "company_id": "company-123",
  "company_name": "Example Corp",
  "created_at": "2024-01-01T00:00:00Z",
  "is_active": true
}
```

### Database (snake_case)
```sql
CREATE TABLE user_profiles (
  id SERIAL PRIMARY KEY,
  company_id VARCHAR(255),
  company_name VARCHAR(255),
  created_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);
```

## Core Utilities

### CaseConverter

String-level case conversion utilities:

```typescript
import { CaseConverter } from './lib/case-converter';

// Convert between cases
const camelToSnake = CaseConverter.camelToSnake('userName'); // 'user_name'
const snakeToCamel = CaseConverter.snakeToCamel('user_name'); // 'userName'
const pascalToSnake = CaseConverter.pascalToSnake('UserName'); // 'user_name'
const snakeToPascal = CaseConverter.snakeToPascal('user_name'); // 'UserName'
```

### ObjectConverter

Object-level case conversion:

```typescript
import { ObjectConverter } from './lib/case-converter';

// API Response to Frontend
const apiResponse = {
  company_id: '123',
  company_name: 'Example Corp',
  created_at: '2024-01-01'
};

const frontendData = ObjectConverter.apiToApp(apiResponse);
// { companyId: '123', companyName: 'Example Corp', createdAt: '2024-01-01' }

// Frontend to API
const apiPayload = ObjectConverter.appToApi(frontendData);
// { company_id: '123', company_name: 'Example Corp', created_at: '2024-01-01' }
```

## Database Integration

### Automatic Mapping

Define database table mappings:

```typescript
import { DatabaseMappings } from './lib/case-converter';

export const DatabaseMappings = {
  client_profiles: {
    table: 'client_profiles',
    columns: {
      id: 'id',
      created_at: 'createdAt',
      company_name: 'companyName'
    }
  }
};
```

### Case-Aware Repository

Type-safe database operations:

```typescript
const repo = new CaseAwareRepository<UserProfile>('client_profiles');
const query = repo.query()
  .select('companyName')
  .where('isActive', '=', true)
  .orderBy('createdAt', 'DESC');

const results = repo.mapResults(databaseRows);
```

## API Integration

### API Client with Case Conversion

```typescript
class APIClient {
  // Automatically converts response
  async get<T>(endpoint: string, params?: any): Promise<T> {
    const response = await api.get(endpoint, { 
      params: ObjectConverter.appToApi(params) 
    });
    return ObjectConverter.apiToApp(response.data) as T;
  }

  // Automatically converts request payload
  async post<T>(endpoint: string, data: any): Promise<T> {
    const response = await api.post(endpoint, ObjectConverter.appToApi(data));
    return ObjectConverter.apiToApp(response.data) as T;
  }
}
```

### State Management Integration

```typescript
import { caseAwareActions } from './lib/case-conversion-middleware';

// Actions automatically convert payload case
const actions = {
  loadUser: (userId: string) => caseAwareActions.fetchApiData('/users', { userId }),
  
  updateUser: (profile: UserProfile) => caseAwareActions.updateProfile(profile)
};
```

## Middleware

### Case Conversion Middleware

Automatic case conversion in state management:

```typescript
import { caseConversionMiddleware } from './lib/case-conversion-middleware';

// Applies middleware to store
const store = createStore(rootReducer, applyMiddleware(...caseConversionMiddleware));
```

### Middleware Behavior

1. **API Response Conversion**: Converts snake_case responses to camelCase
2. **API Request Conversion**: Converts camelCase actions to snake_case for API calls
3. **Form Input Conversion**: Converts form submissions
4. **Query Parameter Conversion**: Handles URL query params

## Form Handling

### Form Submission with Conversion

```typescript
const form = useForm<FormData>({
  onSubmit: async (data) => {
    // Data is in camelCase
    const apiPayload = ObjectConverter.appToApi(data);
    
    await api.post('/submit', apiPayload);
  }
});
```

### Form Fields

```typescript
<input
  name="companyName"  // Frontend uses camelCase
  // Middleware automatically converts to company_name for API
/>
```

## Query Parameters

### URL Parameters

```typescript
// Frontend uses camelCase
const params = { sortBy: 'createdAt', filterBy: 'isActive' };

// Middleware converts to snake_case for URL
// ?sort_by=created_at&filter_by=is_active
const url = `/api/data?${ObjectConverter.stringifyQueryParams(params)}`;
```

## Best Practices

### 1. Consistent Usage

- Always use `ObjectConverter.apiToApp` for API responses
- Always use `ObjectConverter.appToApi` for API requests
- Don't manually convert case in business logic

### 2. Type Safety

```typescript
interface UserProfile {
  // Frontend types use camelCase
  companyId: string;
  companyName: string;
}

// API types (separate file)
interface UserAPIResponse {
  // Backend types use snake_case
  company_id: string;
  company_name: string;
}

// Conversion utility
function normalizeResponse(response: UserAPIResponse): UserProfile {
  return ObjectConverter.apiToApp(response);
}
```

### 3. Error Handling

```typescript
try {
  const response = await api.get('/users');
  const data = ObjectConverter.apiToApp(response.data);
  return data;
} catch (error) {
  // Error messages may contain case conversion issues
  if (error.response?.data?.field_name) {
    const frontendField = CaseConverter.snakeToCamel(error.response.data.field_name);
    console.error(`Field ${frontendField} has an error`);
  }
  throw error;
}
```

### 4. Testing

```typescript
// Test case conversion
describe('Case Conversion', () => {
  test('converts API response to frontend format', () => {
    const apiResponse = { company_name: 'Test Corp' };
    const frontendData = ObjectConverter.apiToApp(apiResponse);
    expect(frontendData.companyName).toBe('Test Corp');
  });

  test('converts frontend data to API format', () => {
    const frontendData = { companyName: 'Test Corp' };
    const apiPayload = ObjectConverter.appToApi(frontendData);
    expect(apiPayload.company_name).toBe('Test Corp');
  });
});
```

## Migration Guide

### From Manual Conversion

**Before:**
```typescript
// Manual conversion
const response = await api.get('/users');
const users = response.data.map(user => ({
  id: user.id,
  companyId: user.company_id,
  companyName: user.company_name
}));
```

**After:**
```typescript
// Automatic conversion
const response = await api.get('/users');
const users = ObjectConverter.apiToApp(response.data);
```

### Database Schema Changes

**Before:**
```typescript
// Hard-coded column names
const query = `SELECT company_id FROM users WHERE is_active = true`;
```

**After:**
```typescript
// Using database mapping
const mapping = DatabaseMappings.users;
const query = `SELECT ${mapping.columns.companyId} FROM users WHERE ${mapping.columns.isActive} = true`;
```

## Troubleshooting

### Common Issues

1. **Property not found**: Check case conversion in the data flow
2. **API errors**: Verify field names match API expectations
3. **Database errors**: Ensure column names match database schema

### Debugging

Enable debug logging:

```typescript
const DEBUG_CASE_CONVERSION = process.env.NODE_ENV === 'development';

if (DEBUG_CASE_CONVERSION) {
  console.log('Original:', data);
  console.log('Converted:', ObjectConverter.apiToApp(data));
}
```

## Performance Considerations

- Memoize conversion results for large datasets
- Batch multiple conversions when possible
- Consider using efficient JSON parsing libraries for large payloads

## Future Enhancements

1. **Runtime Case Detection**: Automatically detect case based on data patterns
2. **Custom Converters**: Support for custom naming conventions
3. **Performance Optimization**: Lazy loading of conversion utilities
4. **Type-safe Integration**: Better integration with TypeScript generics