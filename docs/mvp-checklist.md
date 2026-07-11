# MVP Checklist — Recruiter Radar

> Living checklist. Порядок отражает приоритеты: сначала разблокировать доставку,
> затем расширить каналы, затем нарастить количество лидов.
>
> Мигрировано из устаревшего `memory/mvp-checklist.md` (2026-06-21). Проверь актуальность
> перед использованием — некоторые пункты уже закрыты (см. user-scoped auto-memory).

## 0. БЛОКЕР: Telegram delivery (текущий главный приоритет)

Пайплайн `daily-radar` (`apps/web/app/api/cron/daily-radar/route.ts`) проходит 4 гейта:

1. **Subscription** — `subscriptions.status IN ('trial','active','past_due')` (см. `apps/web/lib/db.ts:236`).
2. **Delivery target** — `client_profiles.is_active = true AND telegram_chat_id IS NOT NULL`
   (фильтр в `generateAndDeliverDigests`). Без этого профиль молча пропускается.
3. **Signal freshness** — `source-digest-evidence.sql` требует `latest_published_at >= NOW() - 45d`.
4. **Confidence gate** — только A/B авто-доставляются; C/D держатся на review.

**Диагностика:** `node packages/db/scripts/diagnose-delivery.mjs` — печатает PASS/FAIL по каждому гейту,
показывает первый молчаливый блокер. Read-only.

- [ ] **Поднять локальный Postgres** — текущий блокер. `DATABASE_URL=postgresql://postgres:***@localhost:5432/recruiter_radar`,
      но порт 5432 не слушается (нет процесса postgres; `ECONNREFUSED`). Docker Desktop daemon не запущен.
      Команда подъёма: запустить Docker Desktop → `docker compose up -d postgres` (см. `docker-compose.yml`, `postgres:16-alpine`).
- [ ] Прогнать `diagnose-delivery.mjs`, устранить первый FAIL.
- [ ] Запустить `daily-radar` вручную (POST с `x-api-key: $CRON_API_KEY`), убедиться что `digest.totalSent > 0`.

## КАНАЛЫ ДОСТАВКИ (после Telegram работает)

- [ ] **Email дайджест** — резервный канал (многие агентства читают почту утром)
      Инструмент: Resend.com (работает из РФ, есть Node SDK)
      Формат: тот же что Telegram но HTML письмо
- [ ] **WhatsApp** — через Green API (RU провайдер, работает без VPN)
      https://green-api.com — российский сервис, легальный
- [ ] **VK сообщения** — через VK API (нативно для РФ)
      Актуально для агентств где команда в VK
- [ ] **Веб-интерфейс (личный кабинет)** — дайджест как веб-страница
      Это уже частично есть в Next.js приложении

Приоритет доставки для РФ рынка:
1. Telegram (уже есть) — основной
2. Email через Resend — резервный, +30% охват
3. WhatsApp через Green API — для агентств без Telegram
4. VK — опционально

## УЛУЧШИТЬ КОЛИЧЕСТВО ЛИДОВ (после delivery работает)

> Находка: пункты 3.1 и 3.2 — это КОНФИГ, не код. Адаптеры уже пагинируют и принимают мульти-keywords.

- [ ] **HH.ru пагинация: pages 0..4** — код уже есть (`adapters/hh.mjs`, цикл `for page=0..pages`,
      авто-стоп на пустой странице / `payload.pages`). Дефолт `HH_PAGES=1` → тянет только page=0.
      **Фикс: `HH_PAGES=5` в `.env`** (адаптер поддерживает до `MAX_PAGES=20`). Опционально `HH_PER_PAGE=50`.
- [ ] **Habr keywords расширить: HR, рекрутер, talent, HRBP** — код уже есть
      (`adapters/habr-career.mjs` читает `HABR_CAREER_KEYWORDS`, comma/newline-separated, дефолт только «рекрутер»).
      **Фикс: `HABR_CAREER_KEYWORDS=HR,рекрутер,talent,HRBP,recruiter` в `.env`.**
- [ ] **Добавить источник: hh.ru company pages** (не только вакансии) — это НОВЫЙ код,
      требует `/incremental-implementation`. Тянуть профили работодателей, не только vacancy feed.
