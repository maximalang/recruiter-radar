# Multi-tenancy Isolation Report

## Current State Analysis (21 May 2026)

### ✅ What's Implemented

1. **Database Schema Isolation**
   - `client_profiles` table has foreign key relationships
   - `digest_candidates` properly linked to `client_profiles` via `client_profile_id`
   - `digest_runs` linked to specific client profiles
   - Removed global unique index on agency_name to allow multiple clients with same name

2. **Application-level Checks**
   - `assertDigestEntitlementByClientProfileId()` verifies profile is active
   - All digest queries filter by `client_profile_id`
   - Lead status updates check ownership before modification

### ❌ What's Missing

1. **No owner_id in client_profiles**
   - Current schema lacks ownership tracking
   - No way to verify which user owns which client profile
   - Potential for cross-user data access

2. **Incomplete Access Control**
   - Only checks if profile is active, not ownership
   - No authentication context in most queries
   - API endpoints don't validate user-profile relationship

3. **Data Leakage Risks**
   - Client profile IDs are exposed in API responses
   - No request-scoped tenant isolation
   - Database queries don't enforce tenant context at connection level

### 📝 Critical Findings

1. **Current Isolation Level**: Partial
   - Data is isolated by `client_profile_id` in theory
   - But ownership is not enforced at database level
   - Single compromised profile could access all data

2. **Security Gaps**
   ```sql
   -- Current query only checks if profile exists and is active
   SELECT is_active FROM client_profiles WHERE id = $1
   
   -- Should also check ownership
   SELECT is_active FROM client_profiles WHERE id = $1 AND owner_id = $2
   ```

3. **Missing Components**
   - User authentication middleware
   - Tenant-aware database connections
   - Audit logging for cross-profile access attempts

### 🔍 Specific Issues Found

1. **Digest Route (`/api/digest/route.ts`)**
   - Uses API key authentication only
   - No validation that user owns the client profile
   - Could allow unauthorized access to any client's data

2. **Lead Updates (`updateLeadStatus`)**
   - Verifies profile exists but not ownership
   - User could modify leads for any client profile

3. **Database Queries**
   - All queries include `client_profile_id` filter
   - But filter is provided by caller, not enforced by system

### 🚨 Risk Assessment

| Risk Level | Issue | Impact |
|------------|-------|---------|
| **HIGH** | No ownership validation | Complete data breach possible |
| **MEDIUM** | Exposed client IDs | Information disclosure |
| **LOW** | Missing audit logs | Difficult incident investigation |

### 📋 Recommended Immediate Actions

1. **Add owner_id to client_profiles**
   ```sql
   ALTER TABLE client_profiles ADD COLUMN owner_id BIGINT REFERENCES users(id);
   ```

2. **Implement ownership validation in all queries**
   ```typescript
   // Before: SELECT ... FROM digest_candidates WHERE client_profile_id = $1
   // After:  SELECT ... FROM digest_candidates WHERE client_profile_id = $1 AND owner_id = $2
   ```

3. **Add authentication middleware**
   - Extract user context from session
   - Validate user permissions for each request

4. **Implement audit logging**
   - Log all access attempts with client_profile_id
   - Alert on suspicious cross-profile access