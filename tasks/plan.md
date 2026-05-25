# Implementation Plan: Deployment Preparation

## Overview

Prepare Recruiter Radar for production deployment. Current state: TypeScript clean, build succeeds, tests pass (86/89). Missing: production Docker setup, security hardening, environment documentation, CI/CD enhancements.

## Architecture Decisions

- **Docker strategy**: Multi-stage build for minimal image size; separate web service from n8n/postgres
- **Environment management**: `.env.example` is complete; need production-ready `.env.production.example`
- **Security approach**: Address npm audit findings, add security headers, validate all env vars at startup

## Task List

### Phase 1: Security Hardening
- [x] **Task 1**: Fix npm audit vulnerabilities
  - Run `npm audit fix` for postcss
  - Monitor Next.js canary vulnerabilities; document known-risk items
  - **Verification**: `npm audit` shows 0 vulnerabilities

- [x] **Task 2**: Add security headers to Next.js
  - Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
  - Add to `next.config.ts`
  - **Verification**: Headers present in build output

- [x] **Task 3**: Environment variable validation at startup
  - Add validation for required secrets (SESSION_SECRET, DATABASE_URL, TELEGRAM_BOT_TOKEN)
  - Fail fast with clear error messages
  - **Verification**: App fails with clear error if required env missing

### Phase 2: Infrastructure
- [x] **Task 4**: Production-ready Dockerfile
  - Multi-stage build (builder → runner)
  - Non-root user for security
  - Health check endpoint
  - **Verification**: Image builds successfully, runs with `docker run`

- [x] **Task 5**: Health check endpoint
  - Created `/api/health` route
  - Returns status, timestamp, version
  - **Verification**: Endpoint responds with 200

- [x] **Task 6**: Production environment template
  - Create `.env.production.example` with all required vars
  - Document which vars are secrets vs config
  - **Verification**: Template matches .env.example completeness

### Phase 3: CI/CD Enhancement
- [x] **Task 7**: Enhance GitHub Actions workflow
  - Add build step to CI
  - Add Docker build/push for registry
  - Add deployment trigger (manual or on tag)
  - **Verification**: CI passes, Docker image builds in GitHub Actions

- [x] **Task 8**: Add pre-deploy smoke test
  - Health check endpoint test
  - Critical API endpoint test
  - **Verification**: Smoke tests run in CI

### Checkpoint: Testing Ready ✅
- [x] All skipped tests converted to actual API tests
- [x] Critical path tests added (telegram connect)

### Phase 5: Final Review
- [x] **Task 11**: Review unstaged changes
  - Audit `.claude/settings.json`, `CLAUDE.md`, dashboard components
  - Commit or discard appropriately
  - **Verification**: Clean working directory ✅

- [x] **Task 12**: Final build verification
  - Run full `npm run validate`
  - Run full test suite
  - **Verification**: All checks pass ✅

### Checkpoint: Deployment Ready 🚀

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Next.js vulnerabilities | High | Document known risks; plan upgrade path to stable release |
| Missing secrets in CI | Medium | Add GitHub Actions secrets documentation |
| Docker image too large | Low | Use multi-stage build; minimal base image |

## Open Questions

- What is the target deployment environment? (VPS, Kubernetes, managed container service)
- Is there an existing Docker registry for storing images?
- What domain(s) will the app run on? (affects CORS and security headers)

## Files Likely to Change

- `apps/web/next.config.ts` — security headers
- `apps/web/Dockerfile.test` → `apps/web/Dockerfile` — production build
- `docker-compose.yml` — production configuration
- `.github/workflows/test.yml` — CI enhancements
- New: `.env.production.example`
- New: `apps/web/src/lib/env-validation.ts`