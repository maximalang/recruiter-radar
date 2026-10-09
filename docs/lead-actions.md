# Native lead actions (Telegram)

Recruiter Radar keeps lead management on the native Telegram inline keyboard. The
buttons are signed, idempotent, and update the auditable digest-candidate state;
they do not send outreach or expose personal contact data.

## Action contract

| Button | Wire action | `feedback_status` | Digest effect |
|---|---|---|---|
| Беру | `accepted` | `contacted` | Mark the candidate as taken and suppress it from resurfacing. |
| Мимо | `badfit` | `badfit` | Suppress the candidate for the bounded bad-fit period. |
| Позже | `snooze` | `snooze` | Set a bounded cooldown; the candidate may resurface later. |
| Уже написал | `contacted` | `contacted` | Record that outreach has already happened and suppress resurfacing. |
| Ответили | `replied` | `replied` | Record a reply and suppress resurfacing. |
| Созвон | `meeting` | `meeting` | Record a scheduled/held call and suppress resurfacing. |
| Клиент | `won` | `won` | Record conversion and suppress resurfacing. |
| Скрыть | `dismissed` | `dismissed` | Suppress this exact candidate and every entity-resolution fragment of the same employer for the bounded period, via the canonical corroboration key (see below). Company-name similarity alone never widens a suppression. |

`accepted` is intentionally an alias for the existing `contacted` terminal
state; it does not invent a separate business state. `meeting` is a first-class
state so a call is not collapsed into a generic reply or conversion.

## Signed callback wire format

New candidate-bound buttons emit the current compact versioned format:

```text
d3:<client_profile_id_base36>:<digest_candidate_id_base36>:<expiry_base36>:<nonce>:<action_code>:<hmac_tag16>
```

- `d3` is the current emitter version. It binds feedback to the exact digest
  candidate, carries a seven-day expiry (`expiry_base36`), and includes a
  random nonce. PostgreSQL `BIGSERIAL` identifiers are encoded as lowercase
  base36 to keep the signed payload within Telegram's 64-byte
  `callback_data` limit.
- `action_code` is one byte (`a`, `b`, `s`, `c`, `r`, `m`, `w`, `d`; `v` is the
  audit-only `shown` event).
- The HMAC-SHA256 input is the full unsigned d3 payload:
  `<version>:<client_profile_id_base36>:<digest_candidate_id_base36>:<expiry_base36>:<nonce>:<action_code>`.
  The callback carries the first 16 base64url characters of the HMAC tag.

During the codec migration, verification remains compatible with legacy
formats, but they are verify-only and are not emitted by new keyboards:

```text
d2:<client_profile_id_base36>:<org_id_base36>:<action_code>:<hmac_tag22>
d:<client_profile_id>:<org_id>:<action_code>:<hmac_tag22>
```

`d2` and `d` identify an organization, not a digest candidate; they carry no
expiry or nonce. Their HMAC inputs remain respectively
`<version>:<client_profile_id_base36>:<org_id_base36>:<action_code>` and
`<client_profile_id>:<org_id>:<action_code>`, with the first 22 base64url
characters of the tag. They remain accepted only for backward-compatible
verification and must not be described as candidate-bound or expiry-protected.

For all versions:

- The secret is read only from the runtime secret store; it is never persisted
  in callback data or logged.
- UTF-8 byte length is checked against Telegram's 64-byte `callback_data`
  limit before a button is emitted and again before verification.
- Verification rejects unknown versions/action codes, malformed positive
  integer IDs, IDs above PostgreSQL `BIGSERIAL` maximum, wrong tag length,
  missing secret, expired d3 callbacks, and non-constant-time tag comparison.

## Idempotency and audit

The webhook first claims a callback in `webhook_events` using the provider plus
Telegram callback/update idempotency key. A processing claim token prevents a
second worker from applying the same event; stale processing claims are
reclaimed only after the bounded stale window. The callback is acknowledged
through Telegram after the state mutation, and repeated callbacks return the
already-processed path without applying a second state transition.

The state mutation is an upsert into `client_digest_org_state`, preserving the
client profile, organization, digest candidate, feedback status, note, source
lineage, cooldown, suppression, and timestamps. `webhook_events` retains the
raw event envelope and processing outcome for audit/replay diagnostics.

## Cross-fragment suppression ("Скрыть")

`dismissed` additionally writes a row into `client_org_suppressions`
(migration `20260828100000_add_client_org_suppressions.sql`):

- The suppression key is the canonical cross-source corroboration key from
  `org_corroboration_keys_v1`, shared by digest assembly and feedback handling
  (`inn:` / `ogrn:` / `domain:`, platform
  hosts excluded, company-name similarity deliberately excluded; keyless orgs
  fall back to `org:<id>`, which suppresses exactly one org).
- Rows are scoped by `client_profile_id`: a dismissal in one agency never
  affects another agency's candidates.
- The window is bounded by the same `dismissed` suppression period as
  `client_digest_org_state` (30 days by default, clamped) and never shrinks
  on a repeated dismissal (GREATEST on upsert).
- Digest selection (`getDigestItemsForClientProfile` and
  `runDigestForClientProfile`) excludes candidates whose org shares an active
  suppression key inside the candidate SQL before `LIMIT`, so hidden fragments
  cannot consume the result window. The path fails closed if the suppression
  schema is unavailable; it never silently resurfaces a hidden employer.
- The organization-state upsert and ER-suppression upsert use the same database
  transaction. A failed scope lookup/write rolls the state change back and the
  callback is not acknowledged as successful.
- The ER fan-out fires only when the dismissed state transition is actually
  applied. A stale replay rejected by the compare-and-set never re-arms or
  extends a suppression.

## Migration and rollback

`packages/db/migrations/20260825090000_add_meeting_digest_feedback_status.sql`
adds the `meeting` value to the existing PostgreSQL enum. It is applied by the
normal database container entrypoint/migration runner; it is not a production
proof or a reason to bypass the snapshot/`pg_dump` gate. The down migration is
an intentional no-op because PostgreSQL enum values cannot be removed safely
without rewriting the type and existing rows.

`packages/db/migrations/20260828100000_add_client_org_suppressions.sql`
adds the canonical ER-key view and suppression ledger. Its down migration drops
only those additive objects, in dependency-safe order.

All actions remain company-level state only. Lawful contact paths and evidence
remain separate lead-card fields; these buttons never create personal emails,
phone numbers, or mass-outreach actions.
