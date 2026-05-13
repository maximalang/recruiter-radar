# Self-serve MVP launch note

## Flow
Landing → preview → pilot activation → Telegram connection → daily digest → callback feedback → suppression/reweighting.

## Activation readiness (pilot → Telegram → first digest)
- Readiness is evaluated server-side from paid pilot order + linked client profile state.
- Required checkpoints:
  - client profile exists;
  - client profile active;
  - Telegram connected;
  - pilot entitlement active (paid order);
  - first test digest can be requested.
- UI only reflects readiness and next steps; delivery logic remains server-side.
- First test digest should be triggered through existing delivery path (conceptually `/api/digest/delivery` / server delivery functions), without duplicating business logic in onboarding UI.

## Implemented
- `apps/web/lib/db.ts` migrated from legacy `leads/lead_status/deliveries` reads to digest model (`digest_candidates`, `client_profiles`, `client_digest_org_state`) for list/status/send actions.
- Telegram webhook `/api/telegram/webhook` now enforces `TELEGRAM_WEBHOOK_SECRET`, writes to `webhook_events`, is replay-safe via deterministic idempotency key, persists processed/failed statuses, and answers callback queries.
- Billing webhook `/api/billing/webhook`: secret validation + idempotent billing event ledger.
- Self-serve foundations migration aligned to digest model: `digest_delivery_attempts` references `digest_candidates` (not legacy `deliveries`).

## Confidence-gated delivery
Digest candidates are assigned confidence gates (A/B/C/D) based on evidence quality and entity resolution confidence. Delivery behavior:

- **A/B gates**: auto-delivered to Telegram (2+ independent sources or 1 strong source + enrichment)
- **C/D gates**: held from Telegram delivery (single-source aggregation or context-only enrichment)
- **Missing/null gate**: treated as allowed (backward compatibility)

Held candidates are filtered at query level in `/api/digest/delivery` before delivery loop, preventing retry noise.

**Operator inspection**: `npm run digest:held` lists up to 100 most recent C/D candidates with id, digest_run_id, client_profile_id, org_id, confidence_gate, total_score, source_families, created_at.

**Known limitation**: no approval UI yet. Held candidates remain in `digest_candidates` but never create `digest_delivery_attempts` records.

**Next step**: review queue v1 with operator approval workflow (requires schema for review state tracking).

## Required env vars
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `DIGEST_API_KEY`, `RR_APP_BASE_URL`, `BILLING_WEBHOOK_SECRET`.

Additional onboarding/runtime prerequisites:
- `DATABASE_URL` for checkout orders, profiles, and Telegram connect tokens.
- Payment provider env for active pilot entitlement (`PAYMENTS_PROVIDER`, provider-specific keys).
- Configured Telegram bot username/token so connect links can be generated and test digest can be delivered.

## Migration
- Apply `packages/db/migrations/0004_self_serve_mvp_foundations.sql`.
- This migration now expects digest pipeline tables from `20260504090000_add_client_digest_pipeline.sql` (`digest_candidates`, etc.).

## Telegram webhook setup
- Configure Telegram webhook with secret header support (`X-Telegram-Bot-Api-Secret-Token`) equal to `TELEGRAM_WEBHOOK_SECRET`.
- Endpoint: `${RR_APP_BASE_URL}/api/telegram/webhook`.
- Replays are safe: duplicated updates are deduplicated by `webhook_events(provider,idempotency_key)`.

## n8n setup
- Use `n8n/workflows/daily-signals.json` template only with env-backed config (`RR_APP_BASE_URL`, `DIGEST_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, optional `TELEGRAM_API_BASE_URL`).
- Do not move scoring/billing/feedback business logic into n8n; keep it in app APIs.

## Launch blockers
- Entitlement gate must be mandatory for all premium digest deliveries server-side (no optional path).
- Legacy naming (`leadId` in actions/UI) still exists in web layer and should be renamed to `digestCandidateId` for full consistency.
- Existing historical schema/docs still include legacy lead tables; needs explicit deprecation plan.

> См. также root-level `AGENTS.md` для обязательных правил работы Codex (ветки, PR, проверки, продуктовые и архитектурные границы).
