# Self-serve MVP launch note

## Flow
Landing → preview → pilot activation → Telegram connection → daily digest → callback feedback → suppression/reweighting.

## Implemented
- Secrets removed from `n8n/workflows/daily-signals.json`; env placeholders used.
- Telegram webhook `/api/telegram/webhook`: secret validation, callback idempotency, event ledger, callback answer.
- Billing webhook `/api/billing/webhook`: secret validation, idempotent event ledger.
- Delivery attempt ledger + idempotency for Telegram sends.
- Pilot/subscription entitlement helper and optional digest gate.
- DB migration `0004_self_serve_mvp_foundations.sql` for webhook ledgers, checkout/pilot foundations, and billing IDs.

## Required env vars
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `DIGEST_API_KEY`, `RR_APP_BASE_URL`, `BILLING_WEBHOOK_SECRET`.

## Launch checklist
- [ ] Rotate previously leaked tokens/keys.
- [ ] Apply migration `0004_self_serve_mvp_foundations.sql`.
- [ ] Configure Telegram webhook secret header.
- [ ] Configure n8n env vars and re-import workflow template.
- [ ] Enable mandatory entitlement enforcement for automated digest requests.
