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
| Скрыть | `dismissed` | `dismissed` | Suppress this exact candidate for the bounded period. Look-alike/ER-key suppression across similarly named orgs is not implemented yet and is deferred to a future sprint; the button name makes no look-alike promise. |

`accepted` is intentionally an alias for the existing `contacted` terminal
state; it does not invent a separate business state. `meeting` is a first-class
state so a call is not collapsed into a generic reply or conversion.

## Signed callback wire format

New buttons emit the compact versioned format:

```text
d2:<client_profile_id_base36>:<org_id_base36>:<action_code>:<hmac_tag>
```

- `d2` is the current emitter version. PostgreSQL `BIGSERIAL` identifiers are
  encoded as lowercase base36, keeping the maximum signed 64-bit ID within
  Telegram's 64-byte `callback_data` limit.
- `action_code` is one byte (`a`, `b`, `s`, `c`, `r`, `m`, `w`, `d`; `v` is the
  audit-only `shown` event).
- The HMAC-SHA256 input is the full unsigned d2 payload:
  `<version>:<client_profile_id_base36>:<org_id_base36>:<action_code>`.

During migration, verification also accepts the legacy decimal format:

```text
d:<client_profile_id>:<org_id>:<action_code>:<hmac_tag>
```

For legacy `d`, the HMAC-SHA256 input remains
`<client_profile_id>:<org_id>:<action_code>`. Legacy callbacks are accepted for
backward compatibility but are never emitted by new keyboards. Both formats
use the first 22 base64url characters of the HMAC tag.

For both versions:

- The secret is read only from the runtime secret store; it is never persisted
  in callback data or logged.
- UTF-8 byte length is checked against Telegram's 64-byte `callback_data`
  limit before a button is emitted and again before verification.
- Verification rejects unknown versions/action codes, malformed positive
  integer IDs, IDs above PostgreSQL `BIGSERIAL` maximum, wrong tag length,
  missing secret, and non-constant-time tag comparison.

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

## Migration and rollback

`packages/db/migrations/20260825090000_add_meeting_digest_feedback_status.sql`
adds the `meeting` value to the existing PostgreSQL enum. It is applied by the
normal database container entrypoint/migration runner; it is not a production
proof or a reason to bypass the snapshot/`pg_dump` gate. The down migration is
an intentional no-op because PostgreSQL enum values cannot be removed safely
without rewriting the type and existing rows.

All actions remain company-level state only. Lawful contact paths and evidence
remain separate lead-card fields; these buttons never create personal emails,
phone numbers, or mass-outreach actions.
