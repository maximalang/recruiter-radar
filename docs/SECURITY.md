# Security Considerations

## Known Vulnerabilities

### Next.js canary dependencies (documented 2026-05-25)

The project uses Next.js canary versions which pull in transitive dependencies with known vulnerabilities. These are addressed where possible but some require upstream Next.js fixes.

| Package | Severity | Status | Mitigation |
|---------|----------|--------|------------|
| postcss <8.5.10 | Moderate | Partial | Overridden to 8.5.15; Next.js internally still uses 8.4.31 |
| Next.js canary vulnerabilities | High | Monitoring | Plan upgrade to stable release |

### PostCSS XSS (CVE reference: GHSA-qx2v-qp2m-jg93)

**Context**: The postcss vulnerability allows XSS via unescaped `</style>` in CSS stringify output.

**Assessment**: Low risk in Recruiter Radar because:
- Next.js uses postcss internally for CSS processing (Tailwind, CSS modules)
- User-provided CSS is not processed through postcss stringify
- The attack surface requires the application to output user-controlled CSS content

**Actions**:
- Monitor Next.js releases for stable version with patched postcss
- When upgrading Next.js, verify postcss version is >=8.5.10
- If application expands to allow user CSS input, re-assess

## Security Best Practices Implemented

1. **No secrets in repository** — All secrets via environment variables
2. **SESSION_SECRET required** — Signed cookies with ≥32 char secret
3. **Secure cookie flag** — Defaults to true in production
4. **Input validation** — All user inputs validated via Zod schemas
5. **RBAC middleware** — Role-based access control on API routes

## Recommendations for Production

1. Upgrade to Next.js stable release when available
2. Enable CSP headers (see next.config.ts)
3. Run periodic `npm audit` checks in CI
4. Set up dependency monitoring (e.g., Dependabot)
