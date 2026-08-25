# Threat model: verified trial, immutable profile, and multi-provider auth

**Status:** Contract-level review for the first implementation PR. No production
change is authorized by this document.

## Assets and trust boundaries

| Asset | Boundary | Required property |
|---|---|---|
| Trial claim | Account/auth ↔ database | One-time binding, replay-safe, minimal data |
| Trial entitlement | Entitlement service ↔ database | Exactly 3×24 hours from server activation |
| Client profile | UI/API/payment/Telegram/admin ↔ profile service | Owner-scoped and immutable during trial |
| Auth identity | Provider ↔ account-linking service | Verified subject, no silent account takeover |
| Claim/grant audit | Domain service ↔ database | Durable decision trail without raw PII |

The browser, Telegram update body, OAuth redirect parameters, provider email
claim, and client-supplied profile id are untrusted. PostgreSQL constraints and
triggers are trusted backstops, not optional optimizations.

## Threats and controls

| Threat | Example | Required control | Regression evidence |
|---|---|---|---|
| Trial replay | Re-submit activation after success | Durable unique binding claims, component anti-abuse indexes, and user lock | Same binding returns `already_claimed`; second binding fails |
| Account deletion reset | Delete account, register again, activate | Retained keyed binding hash with retention/appeal policy | Delete/recreate test remains `trial_already_used` |
| Concurrent activation | Two tabs activate at the same time | Transaction lock + unique constraint; no client flag | Parallel activation yields one entitlement/profile |
| Profile replacement | Delete profile and create a new one | DB `DELETE`/`INSERT` guard tied to active claim | SQL race test rejects both bypass attempts |
| Profile update bypass | Payment/Telegram/admin path changes filters | One domain policy service used by every writer | Entry-point matrix tests all writers |
| Forged profile id | Form/API sends another tenant's id | Resolve profile by authenticated owner/workspace only | IDOR test proves no cross-tenant write |
| Expiry manipulation | Client supplies duration/end date | Fixed server plan; DB check on window | Payload duration is ignored/rejected |
| Auth account takeover | OAuth email matches an existing account | Provider subject mapping + verified challenge + recent reauth | Matching email without challenge cannot link |
| OAuth replay/CSRF | Reuse callback or alter redirect state | State/PKCE, single-use challenge, expiry | Replay and state mismatch tests fail closed |
| Telegram spoof | Fake actor/chat or reused connect token | Signature/connect-token verification and actor binding | Wrong actor/chat cannot activate or link |
| Session fixation | Old/legacy cookie used for trial mutation | Signed session, rotation, recent reauth for sensitive actions | Legacy/session-rotation tests deny mutation |
| Admin bypass | Operator edits a locked trial profile | No implicit break-glass; explicit audited transition only | Admin mutation test returns policy denial |
| PII leakage | Raw email/Telegram stored in anti-abuse table/logs | Versioned keyed hashes; sanitized audit payloads | Schema/log scan rejects raw identifiers |
| Availability fail-open | DB/entitlement check times out | Deny activation/profile mutation on uncertainty | DB error returns stable 503/deny, no write |

## Abuse and privacy policy requirements

- The anti-abuse record contains only the minimum versioned keyed hashes and
  lifecycle metadata needed to enforce the one-time binding.
- The pepper/key is runtime-only, rotated by version, and never stored in the
  database or repository.
- Retention duration, deletion exceptions, and an appeal/recovery procedure must
  be approved before production enablement. Deleting an account does not delete
  the claim before its retention window expires.
- Logs and audit events use internal ids, decision codes, and hash versions;
  never raw email, phone, username, tokens, or connection strings.

## Review order

1. Claim the exact entry points and data model.
2. Extract current behavior with focused tests and a disposable database.
3. Doubt every UI/service-only guard and every provider email-link assumption.
4. Reconcile service behavior, database constraints, audit events, and retry
   semantics.
5. Stop before migration/canary/production enablement until security review,
   backup gates, and rollback evidence are complete.
