# Security Hardening — Recruiter Radar

Версия: 1.0
Дата: 2026-05-25
Связанные документы: `docs/plan.md` v2.0 Фаза 6

## Аудит веб-хуков

### Telegram webhook (`/api/telegram/webhook`)

| Аспект | Статус | Детали |
|--------|--------|--------|
| Аутентификация | ✅ | `TELEGRAM_WEBHOOK_SECRET` via `x-telegram-bot-api-secret-token` |
| Идемпотентность | ✅ | `ON CONFLICT (provider, idempotency_key)` + claim token со stale-reclaim |
| Rate limiting | ⚠️ | Встроенный claim token частично защищает от replay; внешний rate-limit на уровне infrastructure |
| Replay-safety | ✅ | Статус `processed`/`ignored` — ответ `{ ok: true, replaySafe: true }` |
| Логирование | ✅ | `webhook_events` table; ошибки фиксируются в `error_message` |

**Примечание:** встроенный `RateLimiter` в `secure-validation-schemas.ts` не применяется к webhook endpoint. Это приемлемо, т.к. claim-token pattern обеспечивает idempotency.

### Billing webhook (`/api/billing/webhook`)

| Аспект | Статус | Детали |
|--------|--------|--------|
| Аутентификация | ✅ | `BILLING_WEBHOOK_SECRET` via `x-billing-secret` |
| Идемпотентность | ✅ | `ON CONFLICT (provider, idempotency_key) DO NOTHING` |
| Rate limiting | ⚠️ | Нет endpoint-level rate-limit. Рекомендуется добавить на уровне infrastructure (nginx/cloud) |
| Claim token | ✅ | stale-reclaim через 10 минут |

### Уязвимости и mitigations

1. **Replay attacks на Telegram webhook:** Mitigated через `update_id`-based idempotency. Дубликатный callback возвращает `{ ok: true, replaySafe: true }` без повторной обработки.

2. **Missing billing rate-limit:** При высокой частоте входящих webhook events возможен DoS через table bloat. Mitigation: rate-limit на infrastructure level (Cloudflare/nginx). Бизнес-риск: низкий (billing provider — контролируемая сторона).

3. **Claim token staleness:** Telegram webhook — 90 секунд; billing webhook — 10 минут. Оба значения reasonable для нашего use case.

## Аудит n8n workflows

n8n workflows не найдены в репозитории (`n8n/workflows/*.json` — 0 файлов). Workflows хранятся в managed n8n instance, не в git. Это корректное разделение — секреты не попадают в кодовую базу.

**TODO:** При первом экспорте workflow в git убедиться, что `credentialOverwrites` очищены.

## Rotation Playbook

### SESSION_SECRET

```bash
# 1. Генерируем новый secret
openssl rand -hex 32

# 2. Ротация без downtime (graceful rollout):
#    - Записать новый secret в DATABASE_URL (через env в deployment)
#    - Существующие сессии продолжают работать со старым SESSION_SECRET в rr_session cookie
#    - Новые сессии создаются с rr_sid + HMAC от нового ключа
#    - После natural session expiry (SESSION_COOKIE_AGE ~30 дней) миграция завершена
```

### Telegram bot token

```bash
# 1. Создать нового бота через @BotFather /revoke
# 2. Обновить TELEGRAM_BOT_TOKEN в infrastructure secrets manager
# 3. Restart n8n workflows, использующих Telegram nodes
# 4. Старый токен invalid сразу после revoke
```

### Rate-limit configuration

| Endpoint | Limit | Window | Описание |
|----------|-------|--------|---------|
| `/api/telegram/webhook` | 60 req | 1 min | Per bot token |
| `/api/billing/webhook` | 30 req | 1 min | Per billing provider |
| Internal rate-limiter | 100 req | 1 min | Per validation key |

## Secrets, которые НЕ должны быть в репозитории

| Secret | Где должен быть |
|--------|-----------------|
| `TELEGRAM_BOT_TOKEN` | Environment variable / secrets manager |
| `TELEGRAM_WEBHOOK_SECRET` | Environment variable |
| `BILLING_WEBHOOK_SECRET` | Environment variable |
| `DATABASE_URL` | Environment variable |
| `SESSION_SECRET` | Environment variable |
| n8n credentials | n8n-managed credentials (не git-экспорт) |

## Checks

```bash
# Проверка отсутствия секретов в коде
git grep -E "(bot\d+:[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,})" -- "*.ts" "*.tsx" "*.js"

# Проверка отсутствия .env в коммитах
git log --oneline --all --full-history -- "*.env*" | head -5
```