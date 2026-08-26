# ADR: Verified three-day trial with an immutable trial profile

- **Status:** Proposed contract; runtime implementation is a separate vertical PR and remains disabled until provider and production gates pass.
- **Owner:** backend/auth boundary
- **Scope:** trial activation, profile mutability, entitlement boundaries, and provider rollout.

## Context

The product needs a short trial without allowing a user to delete and recreate a
profile to obtain free access repeatedly. The current code has several legitimate
profile-write entry points:

- `apps/web/app/profile/actions.ts` → `saveSettingsProfileAction` →
  `lib/clientProfiles.ts` → `saveClientProfile`;
- payment and Telegram-connect flows in `apps/web/lib/payments.ts` and
  `apps/web/lib/paymentsRepo.ts`;
- operator actions in `apps/web/lib/admin/adminUsers.ts`;
- direct database writes to `client_profiles` must also be protected because
  service-only checks do not close a concurrent SQL/write race.

The current entitlement resolver supports `trial` and `pilot` sources, but its
admin/service grant API accepts a generic duration. That is not a contract for a
three-day self-serve trial. The existing `pilot_enrollments` model is retained
for the current pilot and is not silently reinterpreted as the new trial.

Auth v2 already supplies the foundation for signed sessions, magic-link login,
and feature-flagged passkeys. A source audit found no Yandex OAuth or Telegram
Sign-in adapter entry point; those are separate provider PRs, not claims of
current availability.

## Decision

### 1. Activation is server-side and requires two verified identities

A trial can be activated only when both conditions are true in the same
server-side transaction:

1. the account email has a verified auth identity;
2. the Telegram account has been linked through the authenticated connect flow
   and the numeric Telegram actor/chat identity is verified.

The browser cannot choose the activation timestamp, end timestamp, profile id,
or trial duration. The canonical plan is `radar-trial-3d`; its window is exactly
`starts_at + 3 * 24 hours`, measured by PostgreSQL/server time.

A durable trial-claim record stores only versioned keyed hashes of the normalized
email/Telegram binding and the activation/expiry/audit state. It stores no raw
email, phone number, Telegram username, or message payload. The binding hash is
kept after account deletion under a documented retention and appeal policy, so a
new account cannot reset the same trial. The exact pair `(verified_email,
verified_telegram_actor)` is the one-time key; broad email-only or Telegram-only
blocking is stricter in this implementation: each verified component also has a
unique anti-abuse index; @user/@rr-support must approve that privacy policy
before merge.

The claim has durable unique binding keys. A retry of the same activation returns
`already_claimed`; a different account or request with the same binding fails
closed. Concurrent activations are serialized by the database
uniqueness/row-lock path, not by a client-side flag. The stable account-level
error for a previously consumed trial is `trial_already_used`.

### 2. Trial entitlement has one narrow mutation service

Self-serve code calls a dedicated `activateVerifiedTrial` service. It
must not accept `durationDays`, arbitrary plan names, or an operator source.
The service transaction:

1. locks the authenticated account and the durable claim key;
2. re-checks verified email and verified Telegram state;
3. verifies exactly one active pre-activation profile exists in the requested
   workspace; activation fails closed when it does not;
4. creates exactly one trial entitlement with the fixed three-day window and a
   durable claim/profile lock record;
5. retains claim and entitlement rows as the non-sensitive audit trail;
6. commits atomically.

The existing generic entitlement grant functions remain for explicitly scoped
operator/payment flows, but they cannot be used by the self-serve trial path.
Trial access is fail-closed when the entitlement lookup, claim lookup, or
verification state is unavailable.

### 3. Profile mutability is a service and database invariant

The user completes the initial profile before activation; activation binds that
single existing profile and makes it immutable while trial access is active.
The following are denied with a stable domain error:

- editing any profile field;
- changing `is_active` or delivery/profile filters;
- deleting the profile;
- creating a replacement profile;
- mutating the profile through payment-connect, Telegram, admin, API, server
  action, or a concurrent direct SQL path.

The implementation must add an explicit lock relation/marker tied to the durable
trial claim, a unique one-profile-per-claim constraint, and database triggers or
row-level guards that reject `UPDATE`, `DELETE`, and replacement `INSERT` while
the trial policy is locked. Service guards return a user-safe 403/409 response;
the database guard is the race-condition backstop. There is no unlogged support
or admin bypass in the first implementation.

After the three-day window, the database guard stops applying the active-trial
lock. A separate entitlement/policy transition must decide whether normal
profile edits are allowed; expiration alone never creates a new trial or grants
new entitlement access.

### 4. Authentication provider rollout is incremental

Provider support is delivered as separate vertical PRs with one identity table
and one canonical account-linking policy:

1. existing magic-link + signed-session hardening and recovery evidence;
2. passkey registration/login canary and recovery/reauth evidence;
3. Yandex OAuth with state/PKCE, provider-subject uniqueness, and explicit
   account-link confirmation;
4. Telegram Sign-in with signature verification, actor binding, replay
   protection, and explicit account-link confirmation;
5. password + TOTP only after breach-safe hashing, rate limits, recovery, and
   canary evidence are complete.

No provider may auto-link an account solely because an untrusted provider email
matches an existing email. Linking requires a verified challenge and recent
reauthentication. Provider flags remain fail-closed and canaryable.

### 5. Architecture is organized by enforceable boundaries

The target module boundary is:

```text
authentication → identity/linking → entitlement → profile policy
→ profile persistence → digest/delivery
```

Routes and server actions resolve auth and call domain services; they do not
write `client_profiles` directly. Entitlement decisions are centralized, and
profile-policy decisions are reusable by UI, API, payment, Telegram, admin, and
worker paths. Each vertical PR must include tenant-isolation, replay, race, and
failure-mode tests plus a baseline of latency, error rate, and authorization
outcomes before optimization claims are made.

## Non-goals

- No production migration, entitlement activation, or auth flag enablement in
  this contract PR.
- No promise that Yandex OAuth or Telegram Sign-in is already available.
- No change to the existing seven-day pilot until the three-day trial is a
  separate, tested entitlement contract.
- No broad refactor or speculative performance rewrite without a measured
  baseline.

## Acceptance gates for the implementation PR

- service tests cover first activation, retry idempotency, expired trial,
  mismatched binding, account deletion/recreation, and concurrent activation;
- every profile mutation entry point is enumerated and covered;
- PostgreSQL disposable migration proves unique claim/profile constraints and
  trigger fail-closed behavior;
- route/API tests prove no profile id from the client can bypass ownership or
  trial lock;
- security review covers auth/session, entitlement, profile policy, and audit
  boundaries before any migration or canary enablement;
- production snapshot/backup and release gates remain separate from this local
  contract work.
