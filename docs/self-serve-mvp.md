# Self-serve MVP launch note

> **Статус:** historical rollout note. Актуальные runtime-контракты находятся в `SPEC.md`, `docs/CURRENT_STATE.md`, `docs/architecture.md` и `docs/notification-delivery.md`.

## Historical flow

Первоначальный flow был: Landing → preview → pilot activation → shared Telegram connection → daily digest → callback feedback → suppression/reweighting.

Текущий продукт поддерживает несколько delivery channels и customer-managed provider accounts; Telegram больше не является обязательным единственным каналом.

## Activation readiness

Readiness всегда оценивается server-side. Для активации нужны:

- существующий и активный client profile;
- действующий pilot/subscription entitlement либо явно разрешённый sales-assisted state;
- хотя бы один пригодный notification channel;
- возможность создать и доставить test notification/digest через общий delivery path.

UI только отражает readiness и следующий шаг. Он не дублирует entitlement или delivery business logic.

## Implemented foundations

- Web reads переведены на digest model (`digest_candidates`, `client_profiles`, `client_digest_org_state`).
- Telegram и billing webhooks используют secret validation и idempotent event ledger.
- Notification platform добавляет provider accounts, endpoints, routes, durable jobs/attempts, replay-safe inbound events и audit log.
- Premium delivery проверяет entitlement server-side.
- Legacy lead tables задепрекейчены и не используются production queries.

## Confidence-gated delivery

Digest candidates получают gates A/B/C/D:

- A/B могут быть доставлены автоматически согласно текущей confidence policy;
- C требуют review/hold policy;
- D не является lead;
- высокий score не обходит gate.

Held candidates остаются доступными оператору и не должны создавать ложный successful delivery state.

## Runtime prerequisites

Минимально требуются:

- `DATABASE_URL`;
- `SESSION_SECRET`;
- `CRON_API_KEY`;
- `NEXT_PUBLIC_APP_URL`;
- notification encryption key и provider-specific credentials для реально включённых каналов;
- payment provider configuration только если используется self-serve checkout;
- source-specific compliant credentials/configuration для live источников.

Точный список определяется runtime validators и provider setup state. Fixture или отсутствующий token не считается production readiness.

## Production scheduling

Production не использует n8n как обязательный orchestration layer.

- GitHub Actions вызывает fenced `/api/cron/daily-radar` основным и recovery-триггером; PostgreSQL владеет eligibility/backoff.
- Repository-controlled retry workflow вызывает `/api/cron/notification-delivery-retry`.
- Клиентский n8n может принимать signed webhook как один из notification endpoints.
- Scoring, billing, feedback, suppression, digest state и entitlement остаются в приложении/PostgreSQL.

Исторический `n8n/workflows/daily-signals.json` не является production source of truth.

## Known external blockers

- Реальные provider credentials и webhook registration нельзя подтвердить unit fixture.
- Stripe является единственным реализованным payment adapter; RF provider требует отдельного выбора, credentials, sandbox/live validation и legal/accounting review.
- Monthly/quarterly request flow не равен автоматической recurring subscription.
- Production observability и distributed rate limiting требуют внешней инфраструктуры.

## Verification

См. обязательную матрицу в `docs/CURRENT_STATE.md` и root-level `AGENTS.md` / `CLAUDE.md`.
