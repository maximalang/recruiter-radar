# Self-serve MVP launch note

## Flow
Landing → preview → pilot activation → Telegram connection → daily digest → callback feedback → suppression/reweighting.

## Implemented
- `apps/web/lib/db.ts` migrated from legacy `leads/lead_status/deliveries` reads to digest model (`digest_candidates`, `client_profiles`, `client_digest_org_state`) for list/status/send actions.
- Telegram webhook `/api/telegram/webhook` now enforces `TELEGRAM_WEBHOOK_SECRET`, writes to `webhook_events`, is replay-safe via deterministic idempotency key, skips duplicate `processed/ignored` events without re-running feedback mutation, answers callback queries (`Уже обработано` for duplicates), and returns `ok + duplicate` response for replays.
- Billing webhook `/api/billing/webhook`: secret validation + idempotent billing event ledger.
- Self-serve foundations migration aligned to digest model: `digest_delivery_attempts` references `digest_candidates` (not legacy `deliveries`). Runtime delivery now records `queued/sent/failed/skipped` attempts and prevents duplicate Telegram sends via `digestCandidateId:channel:target` idempotency key.

## Required env vars
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `DIGEST_API_KEY`, `RR_APP_BASE_URL`, `BILLING_WEBHOOK_SECRET`.

## Migration
- Apply `packages/db/migrations/0004_self_serve_mvp_foundations.sql`.
- This migration now expects digest pipeline tables from `20260504090000_add_client_digest_pipeline.sql` (`digest_candidates`, etc.).

## Telegram webhook setup
- Configure Telegram webhook with secret header support (`X-Telegram-Bot-Api-Secret-Token`) equal to `TELEGRAM_WEBHOOK_SECRET`.
- Endpoint: `${RR_APP_BASE_URL}/api/telegram/webhook`.
- Replays are safe: duplicated updates are deduplicated by `webhook_events(provider,idempotency_key)`.

## n8n setup
- Use `n8n/workflows/daily-signals.json` template only with app API delivery call (`/api/digest`) and env-backed config (`RR_APP_BASE_URL`, `DIGEST_API_KEY`, `DAILY_DIGEST_CLIENT_PROFILE_ID`). Production flow must not call Telegram Bot API directly from n8n.
- Do not move scoring/billing/feedback business logic into n8n; keep it in app APIs.

## Launch blockers
- Mandatory entitlement gate is enforced server-side in digest APIs (`/api/digest` and `/api/hh/digest`) before digest generation/delivery.
- Legacy naming (`leadId` in actions/UI) still exists in web layer and should be renamed to `digestCandidateId` for full consistency.
- Existing historical schema/docs still include legacy lead tables; needs explicit deprecation plan.
