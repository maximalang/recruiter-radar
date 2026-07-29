# Auth Platform v2

**Статус:** active

**Дата:** 2026-07-28

**Ветка аудита:** `codex/auth-v2-foundation`

**Базовый commit:** `5a2ae2d2a650b448165db5324c396a6f30caa70a`

**Область:** customer authentication, account security, workspace tenancy и безопасная миграция существующих tenant-данных
**Не заменяет:** `SPEC.md`, `AGENTS.md`, `CLAUDE.md`; при конфликте они имеют приоритет

## 1. Objective

Нужно заменить текущую owner-cookie модель на passwordless Auth Platform v2:

- пользователь создаётся только после подтверждения рабочего email;
- одноразовые challenges хранятся только в виде hash, purpose-bound, single-use и concurrency-safe;
- customer session хранится server-side, отзывается, ротируется и имеет idle/absolute expiry;
- user identity отделена от workspace tenancy;
- существующие профили, checkout, entitlement, delivery, Opportunities и Outcome Ledger не теряют данные;
- signup и login используют единый flow;
- passkeys являются optional дополнительным методом, email остаётся recovery/fallback;
- customer auth никогда не открывает operator/admin контур;
- незавершённые возможности скрыты fail-closed feature flags;
- rollout заканчивается готовностью к canary, но не production deployment.

Целевые пользователи:

1. новый владелец рекрутингового агентства;
2. существующий owner с профилем, оплатой и Opportunity history;
3. приглашённый участник workspace;
4. пользователь нескольких workspace;
5. оператор Recruiter Radar, чей отдельный admin-контур не меняется.

## 2. Scope и non-goals

### В scope

- email login/signup, resend, verify и explicit confirm;
- server-side sessions и legacy-cookie exchange;
- workspace, membership, invite, roles и permissions;
- миграция tenant-owned данных;
- onboarding;
- account security, email change, deletion request;
- team management;
- optional passkeys;
- authorization DAL;
- audit/operational telemetry;
- preflight, backfill, verifiers, CI, E2E, accessibility и rollout runbook.

### Не в scope

- passwords, SMS, security questions, social/OAuth login;
- обязательная CAPTCHA или обязательный passkey;
- provider-specific email canonicalization;
- объединение customer и operator/admin auth;
- production deployment или глобальное включение Auth v2;
- Agency DNA, новый scoring, CRM, Revenue Forecast, новые hiring sources;
- unrelated UI redesign;
- изменение DNS или платных email-настроек.

## 3. Проверенный baseline

Preflight выполнен на актуальном `main`:

```text
git fetch origin
git pull --ff-only origin main
HEAD = 5a2ae2d2a650b448165db5324c396a6f30caa70a
```

Открытых auth-related PR на момент аудита нет. В рабочем дереве до начала задачи были
только чужие untracked `.cache/` и два `.claude/*.bak`; они не входят в scope.

Baseline:

```text
npm.cmd run web:check
PASS, exit 0

npm.cmd run db:validate
PASS, exit 0, 102 .mjs files

npm.cmd run test --workspace @recruiter-radar/web -- --runInBand \
  --runTestsByPath \
  src/__tests__/lib/account-auth.test.ts \
  src/__tests__/app/auth-verify-route.test.ts \
  src/__tests__/app/login/login-form.test.tsx
PASS, 3 suites / 12 tests
```

Первая попытка узкого Jest regex не запускала тесты из-за Windows-разбора `|`;
она не считается test result.

## 4. Аудит текущей системы

### 4.1. Текущий login flow

Текущий flow уже имеет полезную безопасную форму:

```text
email link с token во fragment
→ /auth/verify удаляет fragment
→ POST /api/auth/login/verify
→ HttpOnly rr_login_pending
→ explicit POST /auth/confirm
→ rr_sid
```

Полезные свойства, которые сохраняются:

- token не находится в query string;
- GET не создаёт session;
- `returnTo` ограничен локальным allowlist;
- challenge имеет 256 бит entropy, SHA-256 hash и TTL 15 минут;
- публичный request result в основном generic;
- confirm требует отдельного пользовательского действия.

### 4.2. Confirmed gaps

1. `requestAccountLogin()` выполняет `INSERT INTO users` до email verification.
   Это нарушает основной invariant и позволяет создавать dormant identities.
2. `account_login_challenges.user_id` обязателен, поэтому challenge нельзя создать
   до user.
3. resend не инвалидирует предыдущие активные challenges.
4. challenge model не purpose-bound и не покрывает invite, reauth, email change и
   deletion.
5. rate limit доверяет первому `x-forwarded-for` из request без deployment trust
   policy.
6. current global/source/user counters находятся в login transaction, но нет
   общей модели для всех auth limits и operational report.
7. `isLoginChallengeActive()` проверяет token до consume, но confirm page не
   показывает целевой email.
8. SMTP failure переводит challenge в `failed`, а UI всегда отвечает generic
   success; это правильно для enumeration, но нет полноценного delivery state,
   resend lifecycle и deterministic test outbox.

### 4.3. Текущая session

`apps/web/lib/session.ts` хранит:

```text
rr_sid = ownerId.HMAC("session:" + ownerId)
maxAge = 90 days
```

Confirmed gaps:

- cookie раскрывает user/owner ID;
- session не имеет DB record, revoke, logout-all, device list, idle/absolute expiry;
- logout только удаляет cookie;
- privilege/workspace rotation отсутствует;
- customer и operator cookie используют общий `SESSION_SECRET`, хотя cookies
  разделены (`rr_sid` и `rr_op`);
- legacy owner helpers используются десятками pages, actions и API routes.

### 4.4. Tenant model

Текущий user одновременно является tenant boundary:

- `client_profiles.owner_id`;
- `subscriptions.user_id`;
- `checkout_orders.user_id`;
- legacy `leads.user_id`, `deliveries.user_id`;
- notification platform содержит `owner_id + client_profile_id`;
- Opportunities и Outcome Ledger используют строгие composite owner-context FK;
- product telemetry содержит `owner_id`.

`client_profiles.owner_id IS NULL` до сих пор используется как pilot/anonymous
fallback на части read paths. Одновременно migration
`20260521000000_add_owner_id_to_client_profiles.sql` добавляет CHECK
`owner_id IS NOT NULL`, а `schema/init.sql` не содержит `owner_id`. Это schema/code
drift, который нельзя маскировать destructive migration.

### 4.5. RBAC и operator separation

Migration `20260521010000_add_rbac_tables.sql` создавала глобальные roles,
`user_roles` и `audit_logs`, но migration
`20260712130000_drop_unused_rbac_schema.sql` удалила их как неиспользуемые.

Следствие:

- старую global RBAC схему не восстанавливаем;
- workspace roles создаются заново и scoped составным ключом workspace + user;
- `super_admin` не становится workspace role;
- `rr_op`, `ADMIN_OPERATOR_PASSWORD` и admin API-key path остаются отдельными;
- customer DAL никогда не считается доказательством system-admin доступа.

### 4.6. Integration constraints

- checkout и payment webhook должны сохранить `checkout_orders.user_id`,
  provider payment IDs и enrollment idempotency;
- subscriptions должны сохранить provider customer/subscription IDs;
- существующие `client_profiles.id` должны сохраниться;
- notification provider credentials/endpoints/routes должны остаться связаны с
  тем же profile;
- Opportunities/Outcome Ledger нельзя перепривязать без сохранения composite
  owner-context invariants и append-only events;
- legacy read semantics различаются: некоторые GET возвращают empty `200`,
  некоторые write endpoints возвращают `401/404`; DAL rollout не должен
  непреднамеренно изменить публичные response contracts.

### 4.7. Документационный drift

- `docs/SECURITY.md` заявляет wired RBAC, хотя runtime RBAC удалена;
- `docs/DEPLOYMENT.md` всё ещё описывает Railway как current deploy flow;
- `docs/current-state.md` датирован 2026-07-21 и не отражает последние
  Opportunity migrations;
- указанный во входной Goal файл owner migration имеет timestamp
  `20260521010000`, но фактический файл — `20260521000000`.

Auth v2 docs должны ссылаться на runtime и migrations, а не копировать эти
устаревшие утверждения.

## 5. Assumptions и архитектурные решения

1. Runtime остаётся Next.js 16 / React 19 / Node 22 / PostgreSQL.
2. ID остаются PostgreSQL `BIGINT` для совместимости с существующими relations.
3. Auth tokens имеют 32 random bytes и кодируются в 64 lowercase hex chars.
4. В БД хранятся только SHA-256/HMAC hashes; raw token существует только в
   response/cookie/email transport boundary.
5. `users.email` хранит canonical email; отдельный `email_normalized` вводится,
   чтобы unique identity и display representation не зависели от `LOWER(email)`.
6. Нормализация: Unicode NFC, trim, syntax/length checks, lowercase только
   domain. Gmail dots и `+alias` не меняются.
7. Workspace tenancy вводится additive; legacy `owner_id/user_id` удаляется
   только отдельной будущей Goal после canary и verifier parity.
8. Feature flags не хранятся client-side и включаются только exact `true` либо
   exact numeric allowlist.
9. Production example flags документируются в runbook, а не добавляются в
   `.env*`, которые проектные инструкции запрещают читать/стейджить.
10. Passwordless email остаётся recovery path даже при наличии passkey.

## 6. Threat model

### 6.1. Assets

- account identity и verified email;
- active sessions и reauthentication state;
- workspace membership/roles;
- billing/subscription/payment references;
- client profiles, leads, Opportunities и Outcome Ledger;
- notification credentials;
- passkey public credentials и challenges;
- auth audit trail.

### 6.2. Trust boundaries

1. Browser → Next.js form/action/API.
2. Reverse proxy → application source IP resolver.
3. Application → PostgreSQL.
4. Application → SMTP provider.
5. Browser authenticator → WebAuthn verification endpoint.
6. Legacy `rr_sid` → one-time migration bridge.
7. Customer session → workspace DAL.
8. Operator cookie/API key → admin routes.
9. Backfill/preflight scripts → production-shaped database.

### 6.3. STRIDE controls

| Threat | Abuse case | Required control |
|---|---|---|
| Spoofing | guessed/replayed token, forged cookie, passkey from wrong RP | 256-bit tokens, hashes, exact RP/origin, signature/UV verification |
| Tampering | forged workspace/role/returnTo | server-side membership, allowlisted returnTo, composite FK |
| Repudiation | deny login, invite, revoke, email change | append-only redacted auth audit events |
| Information disclosure | email enumeration, token/log/IP leakage | generic responses, no raw secrets/IP, HMAC identifiers |
| Denial of service | login/resend/passkey/invite flood | concurrency-safe multi-dimensional rate limits and cleanup |
| Elevation | customer session reaches admin, member self-promotes | separate admin boundary, centralized role/permission DAL |

### 6.4. Mandatory abuse tests

- concurrent consume of the same challenge;
- concurrent signup of the same normalized email;
- resend racing consume;
- session rotation/revoke race;
- login CSRF/session swapping;
- open redirect;
- cross-workspace object access;
- invitation accepted by another email;
- self-promotion/last-owner removal;
- email-change takeover;
- passkey challenge replay and wrong origin/RP ID;
- legacy cookie exchanged more than once;
- migration cross-tenant mismatch or count loss.

## 7. Target data model

Точные SQL types и names фиксируются migrations после DB tests. Ниже — contract.

### 7.1. `users`

Additive columns:

```text
email_normalized TEXT
display_name TEXT nullable
status TEXT: active | suspended | deletion_pending | deleted
email_verified_at TIMESTAMPTZ nullable
onboarding_status TEXT: not_started | in_progress | completed
onboarding_step TEXT nullable
onboarding_data JSONB object
last_authenticated_at TIMESTAMPTZ nullable
deleted_at TIMESTAMPTZ nullable
```

Constraints:

- unique `email_normalized` when status is not `deleted`;
- no new user without `email_verified_at`;
- current legacy rows may temporarily have null verification and are handled by
  explicit compatibility state, not silently marked verified;
- `onboarding_data` never stores secrets or unnecessary personal data.

### 7.2. `auth_challenges`

```text
id BIGSERIAL PK
purpose TEXT
email_normalized TEXT
user_id BIGINT nullable FK users
workspace_id BIGINT nullable FK workspaces
token_hash CHAR(64) unique
return_to TEXT
send_status TEXT
request_ip_hash CHAR(64) nullable
user_agent_hash CHAR(64) nullable
expires_at TIMESTAMPTZ
consumed_at TIMESTAMPTZ nullable
invalidated_at TIMESTAMPTZ nullable
created_at TIMESTAMPTZ
```

Purposes:

```text
login | signup | change_email | workspace_invite |
reauthentication | account_deletion | passkey_registration |
passkey_authentication
```

`login` и `signup` могут использовать общий public request endpoint, но purpose
внутри challenge определяется без раскрытия наружу. До consume `user_id` может
быть null; это основной способ не создавать user до verification.

### 7.3. `auth_sessions`

```text
id BIGSERIAL PK
user_id BIGINT FK users
workspace_id BIGINT nullable at DB compatibility layer
token_hash CHAR(64) unique
previous_token_hash CHAR(64) nullable unique
previous_token_valid_until TIMESTAMPTZ nullable
auth_method TEXT
created_at TIMESTAMPTZ
last_seen_at TIMESTAMPTZ
last_authenticated_at TIMESTAMPTZ
idle_expires_at TIMESTAMPTZ
absolute_expires_at TIMESTAMPTZ
rotated_at TIMESTAMPTZ nullable
revoked_at TIMESTAMPTZ nullable
revoked_reason TEXT nullable
ip_hash CHAR(64) nullable
user_agent_hash CHAR(64) nullable
device_label TEXT nullable
legacy_migrated_at TIMESTAMPTZ nullable
```

`workspace_id` назначается DB trigger при создании session. Во время
compatibility window runtime тип остаётся nullable: pre-backfill session с
`workspace_id=NULL` не мутируется, пока workspace rollout выключен для этого
user. После точного `AUTH_WORKSPACES_V2_ENABLED=true` и platform/global либо
canary eligibility каждый session read/rotation требует non-null active
workspace и active membership; потеря доступа fail-closed с
`workspace_access_lost`.

### 7.4. `workspaces`

```text
id BIGSERIAL PK
name TEXT
slug TEXT unique
status TEXT: active | suspended | deletion_pending | deleted
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
deleted_at TIMESTAMPTZ nullable
```

### 7.5. `workspace_members`

```text
workspace_id BIGINT FK workspaces
user_id BIGINT FK users
role TEXT: owner | admin | recruiter | viewer | billing
status TEXT: active | suspended | removed
joined_at TIMESTAMPTZ
invited_by BIGINT nullable FK users
updated_at TIMESTAMPTZ
PRIMARY KEY (workspace_id, user_id)
```

Last owner, self-promotion и ownership transfer защищаются transaction locks и
domain functions, а не только UI.

### 7.6. `workspace_invites`

```text
id BIGSERIAL PK
workspace_id BIGINT FK
email_normalized TEXT
role TEXT
token_hash CHAR(64) unique
invited_by BIGINT FK users
expires_at TIMESTAMPTZ
accepted_at TIMESTAMPTZ nullable
accepted_by BIGINT nullable
revoked_at TIMESTAMPTZ nullable
created_at TIMESTAMPTZ
```

Invite consume требует verified current user с exact `email_normalized`.

### 7.7. `user_passkeys`

```text
id BIGSERIAL PK
user_id BIGINT FK users
credential_id TEXT unique
public_key BYTEA
counter BIGINT
transports TEXT[]
device_type TEXT
backed_up BOOLEAN
backup_eligible BOOLEAN
name TEXT
created_at TIMESTAMPTZ
last_used_at TIMESTAMPTZ nullable
```

Private key никогда не покидает authenticator и не хранится.

### 7.8. `auth_security_events`

Append-only:

```text
id BIGSERIAL PK
event_type TEXT
user_id BIGINT nullable
workspace_id BIGINT nullable
session_id BIGINT nullable
actor_type TEXT
subject_hash CHAR(64) nullable
metadata JSONB object
occurred_at TIMESTAMPTZ
```

Raw email, IP, tokens, cookie, magic link и WebAuthn challenge запрещены.

### 7.9. `auth_rate_limit_buckets`

PostgreSQL-backed fixed/sliding window buckets используются как authoritative
fallback, если нет проверенного Redis. Mutation выполняется atomic UPSERT/row
lock; in-memory limiter не считается достаточным для production auth.

Dimensions:

```text
global | trusted_ip_hash | email_hash | resend | challenge_verify |
passkey_verify | workspace_invite
```

## 8. Email normalization

Algorithm:

1. require string;
2. Unicode NFC;
3. trim outer whitespace;
4. reject CR/LF, separators и control chars;
5. enforce total/local/domain length;
6. parse one mailbox;
7. preserve local part bytes/case in display canonical value;
8. IDN domain → normalized ASCII form, lowercase domain;
9. no dot stripping, plus stripping or provider aliases.

Identity comparison всегда использует `email_normalized`.

## 9. Magic-link lifecycle

### 9.1. Request

1. Validate email/returnTo.
2. Resolve trusted client metadata; never trust arbitrary XFF.
3. Apply global + IP HMAC + email HMAC limits.
4. In transaction lock `(email_hash, purpose)`.
5. Invalidate previous active challenges for same email/purpose.
6. Insert challenge only; do not insert user.
7. Commit.
8. Send branded HTML + text email.
9. Update delivery status without changing public enumeration-safe response.
10. Record redacted events.

### 9.2. Verify bridge

1. Link token exists only in URL fragment.
2. Client removes fragment immediately.
3. POST token with same-origin JSON request.
4. Server applies origin/CSRF policy and verification rate limit.
5. If active, set HttpOnly `__Host-rr_login_pending`.
6. Response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

### 9.3. Explicit confirm

Confirm preview returns masked/target email from server-side challenge; no raw
token reaches client JS after bridge.

Consume transaction:

1. lock challenge row `FOR UPDATE`;
2. reject expired, consumed or invalidated;
3. lock normalized user identity advisory key;
4. find or create one user;
5. set `email_verified_at`;
6. for new user create one workspace + owner membership + onboarding state;
7. choose valid active workspace;
8. create one DB session;
9. mark challenge consumed;
10. append audit event;
11. commit and set session cookie.

Any duplicate/replay returns generic invalid-link state and creates no second
user/workspace/session.

### 9.4. Retention cleanup

`auth:cleanup-challenges` is dry-run by default. `--apply` deletes only
consumed, invalidated or expired challenges older than the configurable
`AUTH_CHALLENGE_RETENTION_DAYS` window (default 14, allowed 1–90), in bounded
`FOR UPDATE SKIP LOCKED` batches. It reports aggregate counters only and never
deletes the append-only security event ledger.

## 10. Session lifecycle

Cookie:

```text
__Host-rr_session=<64 lowercase hex chars>
HttpOnly; Secure; SameSite=Lax; Path=/; no Domain
```

Lifetimes:

```text
idle timeout       14 days
absolute lifetime  30 days
rotation interval  24 hours
last_seen throttle 5 minutes
rotation grace     <= 60 seconds for concurrent in-flight requests
```

Required API:

```text
createSession()
getSession()
readSession()
requireSession()
rotateSession()
revokeSession()
revokeAllSessions()
changeActiveWorkspace()
requireRecentAuthentication()
```

Rules:

- token lookup compares deterministic hash values and never logs input;
- expired/revoked/missing user/missing membership fails closed;
- `last_seen_at` writes are throttled;
- rotation is compare-and-swap under row lock;
- once the current token reaches the 24-hour rotation boundary it no longer
  authorizes through the shared server-side owner/session boundary; recovery
  requires the strict same-origin refresh route;
- the root refresh client rotates within the final five minutes before that
  hard cutoff, while API-only and JavaScript-disabled clients fail closed at
  the cutoff instead of extending the bearer token to absolute expiry;
- previous hash grace may authorize the in-flight request but never creates
  another rotation or resurrects a revoked session;
- workspace switch сохраняет предъявленный hash как non-authorizing revoke
  capability: старый token не читает и не переключает session, но concurrent
  logout/revoke всё ещё находит уже выданный новый token;
- login, reauth, privilege change, email change и workspace switch rotate token;
- logout sets `revoked_at/revoked_reason` before clearing cookie;
- logout-all revokes all user sessions in one transaction;
- recent authentication uses the current session row's
  `auth_sessions.last_authenticated_at`, never a user-global timestamp or
  client time.

## 11. Legacy session migration

Feature flag: `AUTH_LEGACY_SESSION_MIGRATION_ENABLED`.

One-way exchange:

1. no valid v2 cookie;
2. validate legacy `rr_sid` HMAC with current legacy logic;
3. load existing user;
4. select deterministic valid membership after workspace backfill;
5. create `auth_method=legacy_exchange` DB session;
6. append `legacy_session_migrated`;
7. delete `rr_sid`;
8. never issue or renew legacy cookie.

The writable `/api/auth/session/refresh` boundary performs due rotation and
bounded legacy exchange. A small root client calls it on load and every five
minutes; read-only Server Components never mutate cookies.

Every legacy authorization for a v2-eligible user revalidates active account
status, verified identity, the exact migration deadline and the durable
`legacy_session_migrated` fingerprint ledger. After exchange, a copied
`rr_sid` cannot authorize again, even if a canary/global serving flag is later
removed during rollback. Never-migrated users outside the global/canary v2
serving policy retain legacy identity semantics until their rollout stage;
exchange never marks email verified by itself.

A successful magic-link consume appends `login_succeeded` inside the
challenge/session transaction. That event is the user-level, irreversible
legacy-disable marker, so a copied `rr_sid` is denied across devices even when
the confirming browser has no legacy cookie. If the confirming browser does
have a valid legacy cookie, the consume also fingerprints it and appends
`legacy_session_migrated`; that fingerprint remains necessary for the
account-switch case where the legacy cookie and new v2 identity belong to
different users. Clearing the browser cookie is therefore a cleanup step, not
the security boundary.

Removal condition:

- backfill verifier green;
- legacy exchange rate near zero for agreed observation window;
- session report shows no unresolved users;
- explicit follow-up migration removes legacy read path.

## 12. Workspace tenancy и authorization DAL

Server-only DAL:

```text
getSession()
requireSession()
requireRecentAuthentication()
getActiveWorkspace()
requireWorkspace()
requireWorkspaceRole()
requireWorkspacePermission()
requireSystemAdmin()
```

`requireSystemAdmin()` delegates only to current operator/admin boundary and
never accepts customer session, workspace role or client-provided role.

Permissions are explicit maps over workspace roles. Route params, localStorage,
cookie workspace IDs и form fields не являются authorization proof.

Минимальная least-privilege matrix, зафиксированная в
`apps/web/lib/auth-v2/workspaces.ts`:

| Role | Product read/write | Team | Billing | Workspace |
|---|---|---|---|---|
| `owner` | read/write/export | read/invite/manage | read/manage | read/update |
| `admin` | read/write/export | read/invite/manage | read | read/update |
| `recruiter` | read/write/export | read | none | read |
| `viewer` | read only | read | none | read |
| `billing` | none | none | read/manage | read |

`super_admin` отсутствует в workspace roles. Customer DAL не импортирует и не
заменяет operator/admin authorization boundary.

Migration order for consumers:

1. DAL introduced behind v2 flag with legacy compatibility adapter.
2. New v2 routes use DAL only.
3. Existing pages/actions/API migrate in small route groups.
4. Preserve current response semantics where they are deliberate.
5. CodeGraph impact/signature review before each PR finalize.

Minimum audited consumers:

```text
dashboard, checkout, profile, settings, leads, review,
opportunities, outcomes, notifications, billing, exports, team
```

## 13. Tenant-data migration

### 13.1. Additive schema

Add nullable `workspace_id` first to directly tenant-owned tables:

```text
client_profiles
subscriptions
checkout_orders
pilot_enrollments
leads
deliveries
user_search_preferences
notification_provider_accounts
opportunities
```

Notification endpoints/routes/jobs остаются транзитивно scoped через усиленные
composite profile/provider/endpoint/route FK. Opportunity actions и append-only
Outcome Ledger остаются scoped через существующий строгий opportunity context.
`notification_audit_log`, `product_telemetry_events` и
`auth_security_events` сохраняют историческую/transitive модель: migration не
создаёт для них вторую mutable workspace authority и не переписывает ledger.

### 13.2. Backfill

For each existing user with any tenant-owned record:

1. deterministic workspace key from existing user ID;
2. create workspace if absent;
3. create owner membership if absent;
4. set workspace on all nine direct tenant roots;
5. derive provider/opportunity/delivery context from their authoritative parent;
6. preserve all existing primary IDs and provider/external IDs;
7. never update append-only Outcome events outside migration with verified
   context and counts;
8. record counters only, no PII.

Backfill is batch-based, resumable, idempotent and dry-run by default. `--apply`
is required for writes.

### 13.3. Consistency constraints

After verified backfill:

- composite unique keys preserve legacy owner/user together with workspace;
- composite FKs ensure profile/provider/workspace, lead/delivery/workspace и
  notification descendant context agree;
- Outcome events remain protected by the existing immutable opportunity context;
- membership/workspace checks for sessions;
- DB triggers dual-write workspace on new and updated legacy rows;
- legacy columns remain during dual-write window;
- `NOT NULL` is added only after zero-null verifier and canary evidence.

### 13.4. Pre/post aggregates

Must match:

```text
users
auth sessions
user-bound auth challenges (anonymous signup challenges stay unbound)
client_profiles
subscriptions and active entitlement
checkout/payment provider references
leads and deliveries
digest runs/candidates/state
notification accounts/endpoints/routes/jobs
opportunities/actions
outcome events/projection
```

Verifier detects:

- duplicate/invalid normalized emails;
- orphan relations;
- owner/workspace mismatches;
- multiple target workspaces for one legacy tenant graph;
- conflicting old roles;
- profiles with null/hostile owner state;
- invalid active workspace;
- count or external-ID loss.

Operational commands:

```text
npm.cmd run auth-v2:workspaces:preflight
npm.cmd run auth-v2:workspaces:backfill
npm.cmd run auth-v2:workspaces:backfill -- --apply --batch-size=100
npm.cmd run auth-v2:workspaces:verify
npm.cmd run test:auth-v2:workspaces:db
npm.cmd run test:auth-v2:workspace-sessions:db
```

Preflight и verify используют read-only transactions и aggregate JSON без PII.
Backfill dry-run по умолчанию, bounded через batch/max-batches, использует
`FOR UPDATE ... SKIP LOCKED` и допускает безопасный resumable rerun.

## 14. UX flows

### 14.1. `/login`

Unified flow, no login/signup tabs.

Desktop:

- premium split screen;
- existing `BrandLogo`;
- product radar motif and warm neutral palette;
- form width 400–440 px;
- stable state height.

Mobile removes branding panel and preserves primary action visibility.

Copy and fields follow the Goal exactly. States:

```text
form
submitting
email sent
resend cooldown
delivery technical failure
invalid/expired/used link
confirm new session
confirm account switch
```

### 14.2. `/onboarding`

Three resumable server-side steps:

1. name, workspace name, role;
2. minimal Agency Profile;
3. ready state and cabinet handoff.

Each step saves independently; optional fields may be skipped; existing paid
pilot onboarding data is migrated/reused rather than duplicated.

### 14.3. `/settings/security`

- account identity and verification;
- active session list without raw IP;
- revoke one/others/all;
- email change with recent auth and old-email notification;
- passkey management;
- account deletion request with configurable retention policy.

PR 4 implementation invariants:

- every mutation derives the account and current session server-side and
  enforces exact canonical Origin;
- the email token travels only in the URL fragment, is moved by the client into
  a short-lived HttpOnly pending-action cookie, and is consumed only after an
  explicit POST confirmation;
- the primary email remains unchanged before confirmation; a successful
  confirmation is single-use, updates the verified address transactionally and
  revokes every session except the matching current one;
- when confirmation presents a session for the affected account, both the
  email mutation and session preservation require the exact current
  `token_hash`. A previous grace hash rolls the transaction back with a
  reauthentication result and leaves the challenge available for a current
  session; it never performs another sensitive rotation;
- email-change and invite target limits use the same lowercase identity
  boundary as conflict detection, and the target bucket is never consumed
  after the principal/workspace bucket has denied the request;
- a default invite timestamp is refreshed after the per-target advisory lock,
  and replacement revocation is clamped to the replaced invite's `created_at`;
  concurrent sends cannot create an invalid historical ordering;
- deletion requires recent authentication and the exact confirmation phrase,
  blocks an owner while another active member still depends on that owner, then
  immediately revokes sessions, removes memberships, disables owned profiles,
  entitlement and every delivery path, clears delivery contact credentials and
  records a pending deletion request;
- during the legacy owner compatibility window, deletion is also refused after
  role ownership transfer if active workspace data is still keyed to the
  former owner's `user_id`/`owner_id`. This preserves billing and immutable
  Opportunity history instead of partially rewriting the tenant graph; the
  workspace-scoped DAL migration removes this temporary safety boundary;
- deletion and invite acceptance lock the same workspace row before deciding
  whether membership can change, so a concurrent invite cannot orphan an owned
  workspace during account deactivation;
- owner-scoped profile and delivery writes take an active-account,
  active-membership and active-workspace database lock. A writer authorized
  before deletion either commits before deletion cleanup or waits and fails
  closed; it cannot reactivate delivery afterward;
- guarded write statements first take a shared transaction fence, while
  account deletion takes the matching exclusive fence before account and
  workspace locks. Ordinary writers remain concurrent; the rare deletion
  transaction briefly pauses new guarded writes and fails after a five-second
  lock timeout instead of deadlocking. Application transactions that pre-lock
  an account, workspace or notification endpoint acquire the shared fence
  immediately after `BEGIN`, before those row locks; this includes onboarding
  profile sync and notification binding. Legacy child rows whose profile still
  has `workspace_id=NULL` resolve the existing bootstrap workspace for the
  active-context check without rewriting that compatibility row;
- automatic purge is disabled when `AUTH_ACCOUNT_PURGE_AFTER_DAYS` is absent.
  When configured, only an integer from 1 through 3650 is accepted. The policy
  name is recorded from `AUTH_ACCOUNT_RETENTION_POLICY_KEY`, defaulting to
  `manual_review`; these settings are operational configuration, not a legal
  retention determination;
- `auth-v2:accounts:purge` is dry-run by default. `--apply` processes a bounded,
  due-only locked batch, anonymizes identity fields and outstanding invites
  targeting the previous email, deletes revoked push endpoint keys, completes
  the request and preserves subscriptions plus security audit events. The
  operating procedure is in `docs/auth-v2-account-retention.md`.

### 14.4. `/settings/team`

- list members/invites;
- invite, change allowed role, revoke invite, remove member;
- safe ownership transfer;
- no self-promotion, last-owner removal or cross-email accept.

PR 4 implementation invariants:

- invites are workspace-bound, normalized-email-bound, role-bounded,
  single-use and expire after 24 hours;
- the fragment token follows the same pending HttpOnly cookie and explicit POST
  confirmation boundary as email change;
- a wrong-email account cannot consume an invite, replay is rejected and two
  concurrent accepts create one membership and one success audit event;
- invite acceptance checks the workspace rollout before opening a database
  transaction, without requiring the invitee to already have a membership;
- an admin cannot create or manage another admin, no actor can mutate itself,
  and no mutation can create a second owner;
- ownership transfer atomically demotes the previous owner, promotes the
  selected active member, revokes both parties' sessions in that workspace and
  records one target-bound audit event. It does not rewrite legacy tenant or
  immutable audit ownership columns; account deletion stays blocked while
  those rows remain attached to the former owner;
- member removal changes the membership first and revokes every affected
  workspace session in the same transaction.

### 14.5. Accessibility

WCAG 2.2 AA target:

- semantic forms/labels;
- keyboard/focus/aria-live/role=alert;
- minimum 44 px targets;
- 200% zoom;
- contrast and reduced motion;
- 360/390/768/1024/1440 widths;
- automated axe-equivalent checks plus manual checklist.

## 15. Email system

One escaped branded template renderer produces HTML and plain text for:

```text
login/signup
change email
workspace invite
new login
email changed
passkey added/removed
all sessions revoked
account deletion requested
```

Invariants:

- canonical HTTPS origin;
- token only in fragment where applicable;
- no tracking pixel;
- no secrets/PII in query;
- user/workspace strings escaped;
- deterministic test outbox transport;
- production SMTP transport remains provider-agnostic.

Operational checklist documents SPF, DKIM, DMARC, canonical From, Reply-To,
bounce monitoring и retry policy. Code does not change DNS automatically.

## 16. Passkeys

Use maintained standards-based WebAuthn library; do not implement crypto.
Current candidate: `@simplewebauthn/server` + `@simplewebauthn/browser`, subject
to dependency/provenance review in PR 5.

Registration requires verified email + active session + recent auth.
Authentication supports discoverable credentials and conditional UI when the
browser supports it.

Verification requires:

- exact configured RP ID;
- exact HTTPS origin allowlist;
- stored single-use challenge;
- user presence and required user verification;
- credential uniqueness;
- signature verification;
- counter semantics treated as clone signal, not unconditional proof;
- backup eligibility/state persistence;
- replay-safe session creation.

References:

- OWASP Session Management Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Authentication Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Email Validation and Verification Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html
- W3C WebAuthn Level 3:
  https://www.w3.org/TR/webauthn-3/
- SimpleWebAuthn server docs:
  https://simplewebauthn.dev/docs/packages/server

## 17. CSRF, origin и proxy policy

- state-changing auth/account/team operations accept POST/PATCH/DELETE only;
- verify `Origin` exactly against the canonical configured origin; auth
  mutation endpoints reject absent or foreign Origin;
- SameSite=Lax is defense-in-depth, not sole CSRF control;
- no unsafe GET mutation;
- `returnTo` is local allowlist;
- trusted source IP resolver reads only deployment-configured proxy headers;
- no arbitrary `x-forwarded-for`;
- IP is HMACed before persistence/telemetry.

## 18. Audit и operational telemetry

Events:

```text
login_requested, login_email_sent, login_email_failed,
login_succeeded, login_failed, challenge_replayed,
session_created, session_rotated, session_revoked,
all_sessions_revoked, legacy_session_migrated,
workspace_created, workspace_switched,
invite_created, invite_accepted, invite_revoked,
email_change_requested, email_changed,
passkey_added, passkey_removed,
account_deletion_requested, onboarding_completed
```

Operational metrics aggregate counts, latency, failure class, rate-limit denies,
session expiry/revoke/rotation and migration parity. No raw token, cookie, IP,
email, link, passkey challenge or private contact data.

## 19. Feature flags

```text
AUTH_PLATFORM_V2_ENABLED=false
AUTH_WORKSPACES_V2_ENABLED=false
AUTH_ONBOARDING_V2_ENABLED=false
AUTH_PASSKEYS_ENABLED=false
AUTH_LEGACY_SESSION_MIGRATION_ENABLED=false
AUTH_V2_CANARY_USER_IDS=
AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED=false
```

Rules:

- only exact `true` enables booleans;
- all malformed values fail closed;
- allowlist accepts comma-separated positive decimal IDs only;
- wildcard/negative/blank elements invalidate the whole allowlist;
- global enable never follows from a non-empty canary list;
- rollback compatibility is a separate exact-`true` emergency switch used
  only to drain already-issued v2 sessions while issuance remains disabled;
- admin auth ignores customer flags;
- one request resolves exactly one customer identity path.

Dependencies:

```text
workspaces → platform v2
onboarding → platform v2 + workspaces
passkeys → platform v2
legacy exchange → exact migration flag + deadline + v2-eligible existing user
```

## 20. Tooling и commands

Planned scripts:

```text
auth-v2:preflight          read-only, JSON result
auth-v2:verify-db          clean + upgrade DB invariants
auth-v2:backfill           dry-run default, --apply required
auth-v2:verify-backfill    read-only parity
auth-v2:session-report     aggregate only
auth-v2:canary             exact one-user readiness check
auth:cleanup-challenges    dry-run default, --apply required
```

Standard gates:

```text
npm.cmd run guard:router
npm.cmd run web:check
npm.cmd run web:build
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand
npm.cmd run test:types --workspace @recruiter-radar/web
npm.cmd run test:auth-v2:account-team:db
npm.cmd run test:auth-v2:account-team:e2e
npm.cmd run db:validate
npm.cmd audit --omit=dev --audit-level=high
```

Account deletion operations:

```text
npm.cmd run auth-v2:accounts:purge
npm.cmd run auth-v2:accounts:purge -- --apply --batch-size=100
```

Migration gates use fresh isolated PostgreSQL and upgrade fixtures; never the
user database. E2E uses deterministic test email outbox and WebAuthn-compatible
browser fixtures/authenticators.

The PR4 account/team browser gate requires an administrative `DATABASE_URL` and
OpenSSL. It creates and force-drops only a process-named disposable database,
runs Next.js over a one-day local HTTPS certificate in a process-scoped build
directory, and uses isolated Playwright Chromium contexts. It verifies the
security and team surfaces at 390 and 1440 pixels, accessibility semantics,
unexpected console/network findings, other-session revocation, fragment-based
email confirmation, invite email binding, bounded role changes, session
revocation after access changes, and audited ownership transfer. Screenshots
and the JSON report are local ignored artifacts; the deterministic outbox,
certificate, temporary tsconfig, and disposable database are removed in the
runner cleanup.

## 21. CI

Add jobs:

```text
Auth unit
Auth PostgreSQL
Auth migration upgrade
Auth tenancy isolation
Auth E2E
Auth accessibility
Auth security smoke
```

Every PR also runs existing required checks. No gate is reported green unless
the command/job actually ran and exit code/run ID is recorded.

## 22. PR topology

Active integration branch:

```text
codex/auth-platform-v2
```

Implementation PRs target that integration branch sequentially:

1. `codex/auth-v2-foundation` — spec, challenges, rate limits, sessions, legacy bridge.
2. `codex/auth-v2-workspaces` — tenancy schema, backfill, dual-write/verifiers.
3. `codex/auth-v2-ux-onboarding` — unified premium auth UX/email states/onboarding.
4. `codex/auth-v2-account-team` — security, email/deletion, sessions UI, team.
5. `codex/auth-v2-passkeys` — WebAuthn registration/login/management.
6. `codex/auth-v2-rollout` — DAL completion, integration regression, CI/runbook.
7. `codex/auth-platform-v2` → `main` promotion PR only after all six are merged,
   independently reviewed and green.

No implementation PR starts from unverified work. No production deployment is
part of any PR.

## 23. Verification matrix

### Unit

- email normalization and `returnTo`;
- token/session hashing;
- challenge expiry/invalidation;
- session idle/absolute/rotation/revoke;
- role/permission/invite rules;
- passkey option validation;
- audit redaction and flag parsing.

### Concurrency/PostgreSQL

- challenge consume/signup/resend races;
- workspace create uniqueness;
- session rotation/revoke race;
- simultaneous invite accept;
- clean migration and upgrade;
- backfill idempotency/parity;
- composite FK and cross-workspace rejection;
- safe down migrations where possible.

### API/security

- anonymous/expired/revoked session;
- wrong workspace/role;
- origin/CSRF/open redirect;
- enumeration and replay;
- invite hijack;
- email change/logout-all;
- passkey replay/wrong origin/RP.

### E2E

- new signup and existing login;
- resend/expired link/account switch;
- onboarding and logout;
- session revoke;
- invite/role restriction;
- email change;
- passkey registration/login/email fallback.

### Visual/accessibility

Screenshots:

```text
login desktop/mobile, email sent, invalid link,
confirm new session/account switch,
onboarding steps 1/2,
security sessions, team invite, passkey management
```

## 24. Rollout

1. Migrations deployed additive with all flags false.
2. Read-only preflight.
3. Dry-run backfill and aggregate review.
4. Apply resumable backfill.
5. Post-backfill verifier.
6. Enable legacy exchange + Auth v2 for one internal user ID.
7. Internal user signs up through normal UI; no direct SQL identity creation.
8. Observe security events, session metrics, payment/profile/Opportunity parity.
9. Expand canary allowlist explicitly.
10. Global enable requires separate human decision after observation.

## 25. Rollback

Order:

1. clear canary allowlist / disable v2 flags;
2. if already-issued sessions must drain, enable only
   `AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED=true`;
3. keep additive schema and dual-written data;
4. revert serving code to legacy reads;
5. revoke suspicious v2 sessions if needed;
6. do not delete workspaces/backfilled context during incident rollback;
7. only run down migrations proven non-destructive on isolated upgrade fixtures.

Legacy `owner_id/user_id` remains rollback authority throughout this Goal.

## 26. Independent review

Before each security-critical PR completes, reviewer classifies every finding:

```text
confirmed blocker
confirmed non-blocker
false positive
design tradeoff
```

Mandatory review axes:

- auth bypass/fixation/replay/revocation;
- enumeration/login CSRF/open redirect;
- workspace isolation/role escalation/invite hijack;
- email takeover;
- passkey RP/origin/challenge/counter;
- migration loss;
- privacy leakage.

Confirmed blockers must be fixed and reverified. Findings are not applied
automatically without checking them against runtime, tests and this spec.

## 27. Boundaries

### Always

- parameterized SQL;
- external input validation;
- server-side authorization;
- hashes instead of raw secrets;
- generic enumeration-safe public responses;
- feature flags off by default;
- atomic commits and explicit-path staging;
- real tests and honest evidence.

### Already approved by this Goal

- additive DB schema/migrations;
- customer auth flow changes;
- auth rate-limit changes;
- workspace roles;
- reviewed WebAuthn dependency in PR 5;
- auth-specific CI.

### Never

- commit secrets or `.env*`;
- trust client authorization state;
- log raw token/IP/email;
- revive global RBAC as workspace auth;
- mutate append-only outcome history without a verified migration;
- production deploy/global enable.

## 28. Definition of Done

Goal завершена только когда исходная Definition of Done выполнена полностью:

- no user before verified email;
- challenges single-use/concurrency-safe/enumeration-safe;
- opaque revocable rotating DB sessions, server logout/logout-all;
- idle/absolute expiry;
- safe legacy exchange;
- user/workspace separation and tested isolation;
- lossless tenant migration;
- scoped roles/invites;
- unified login/signup and full email states;
- resumable onboarding;
- security/team/email/deletion flows;
- optional passkey with email fallback;
- responsive accessible auth UX and visual evidence;
- HTML/text email templates;
- preflight/backfill/verifiers;
- green local, PostgreSQL, E2E, accessibility and CI gates;
- independent review with no confirmed blockers;
- rollout runbook;
- production flags false;
- final answer says whether production auth canary is ready.
