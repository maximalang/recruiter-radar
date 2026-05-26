# Roadmap: завершение MVP

**Версия:** 2.0
**Обновлено:** 2026-05-26
**Источник истины по продукту:** `SPEC.md`
**Чек-лист исполнения:** `tasks/todo.md`
**Пошаговый runbook с командами и verifications:** `tasks/runbook.md`

Этот документ — рабочая разбивка фаз и критериев приёмки. Полный продуктовый контракт, FIUR-модель, gates и границы — в `SPEC.md`.

---

## Состояние на 2026-05-26

### Завершено
- Postgres поднят в Docker, миграции применены, ≥20 таблиц
- TypeScript clean (`npm run web:check` exit 0), 18 suites / 178 tests passing на 2026-05-26
- Security headers, `SESSION_SECRET`-based session, env validation at startup
- `.env.production.example`, production-ready Dockerfile, `/api/health`
- HH end-to-end pipeline (fetch + ingest + scoring + gates) — основной путь
- FIUR scoring (аддитивная форма) + digest selection + feedback state
- Suppression / reweighting на базе badfit-истории клиента
- Гейтовая фильтрация C/D исключает лиды из доставки

### В работе
- Подключение остальных sources к production-режиму (career-pages, rabota-rossii, tech-job-boards и т.д.)
- n8n daily workflows (HH, career-pages, digest)
- Checkout end-to-end smoke и Telegram onboarding

---

## Фазы

### P0 — критично для MVP (26–28.05.2026)

#### Фаза A. HH end-to-end → дайджест → Telegram
**Цель:** один клиент получает реальный дайджест из HH в Telegram.

Шаги:
1. `npm run source:pipeline:hh` против production-like БД, проверить `org_source_refs` и `hh_signals`
2. `npm run verify:digest:selection` зелёный с реальным `clientProfileId`
3. Запустить `npm run digest` → проверить доставку и callback handling
4. Прогон `verify:dedupe:metrics` после ingest

Критерии приёмки:
- `org_source_refs` пополняется при каждом запуске pipeline
- Дайджест содержит лиды только из gates A/B
- Telegram callback пишет `client_digest_org_state` (`accepted` / `badfit` / `dismissed`)

#### Фаза B. Checkout + Onboarding
**Цель:** новый пользователь может оформить пилот и подключить Telegram за одну сессию.

Шаги:
1. Прогнать checkout-форму с тестовыми данными → запись в `client_profiles`
2. Issuance + activation `telegram_connect_tokens` через бота
3. Проверить, что после активации `clientProfileId` бьётся с тем, что приходит в `/api/digest`

Критерии приёмки:
- Checkout не падает на пустых/невалидных полях (валидация на сервере)
- Telegram connect token одноразовый, expire ≤ 15 минут
- `npm run --workspace=@recruiter-radar/web test -- telegram-connect` зелёный

---

### P1 — расширение источников (28–30.05.2026)

#### Фаза C. Career Pages + Rabota Rossii
**Цель:** добавить два независимых evidence-слоя поверх HH.

Шаги:
1. `packages/db/scripts/career-pages-smoke-targets.json` — 10 российских компаний с Greenhouse / Lever boards (Яндекс, VK, Сбер, Тинькофф, Ozon и аналогичные)
2. `npm run career-pages:smoke` → `npm run source:ingest:career-pages` против БД
3. `npm run verify:rabota-rossii:smoke` → `npm run source:ingest:rabota-rossii`
4. `npm run verify:dedupe:metrics` — убедиться, что одинаковая компания из разных источников склеивается в один `org_id`

Критерии приёмки:
- Лиды из career-pages попадают в дайджест
- Rabota Rossii ingest проходит без ошибок
- Нет дублей между HH и career-pages по `org_id`

#### Фаза D. n8n orchestration
**Цель:** daily workflows запускают source pipelines и digest по расписанию.

Шаги:
1. Поднять n8n с теми же credentials, что в production
2. Workflow: HH daily (06:00 MSK)
3. Workflow: Career Pages daily (07:00 MSK)
4. Workflow: Digest delivery (08:00 MSK)
5. Operational alerts на failures (как минимум — на Telegram operator channel)

Критерии приёмки:
- Workflow в `executions` UI показывает успешные запуски за двое суток подряд
- Падение workflow генерирует alert в operator-канал
- Никаких бизнес-данных решений не появилось внутри n8n (только schedule / webhook / retry / alert)

---

### P2 — рост покрытия (31.05–02.06.2026)

#### Фаза E. LinkedIn + Tech Job Boards
**Цель:** расширить evidence layer для P0-сегмента клиентов.

Шаги:
1. Выбрать LinkedIn provider (Apollo / Clearbit / own) — см. SPEC.md §10 Open Questions #3
2. Задать `LINKEDIN_PROVIDER_API_TOKEN`
3. `npm run verify:linkedin-company-pages:smoke` → ingest для тестового списка
4. `npm run verify:tech-job-boards:smoke` → ingest
5. `npm run verify:mixed-ranking` — confidence scoring корректен для смешанных источников

Критерии приёмки:
- Mixed ranking invariant держится
- Confidence scoring отражает кратность evidence-слоёв
- Нет регресса в дедупе и suppression

#### Фаза F. UI/UX polish
**Цель:** лендинг и dashboard выглядят production-grade.

Шаги:
1. Лендинг: основной CTA, evidence-first копирайт, без forbidden formulations
2. Dashboard: статистика дайджестов, история, настройки профиля
3. Mobile responsive до 320px, touch-friendly targets ≥ 44px

Критерии приёмки:
- Lighthouse mobile Performance ≥ 85, Accessibility ≥ 90 на landing и dashboard
- Все CTA проходят keyboard navigation
- Нет горизонтального скролла на 320px viewport

---

## Риски и митигации

| Риск | Воздействие | Митигация |
|------|-------------|-----------|
| Next.js на canary с известными vulnerabilities | Medium | Документировать known risks, апгрейд на ближайший stable |
| LinkedIn provider токен не получен к фазе E | Medium | Фаза E начинается только после ответа на Open Question #2 |
| n8n credentials попадают в экспорт workflow | High (security) | Перед коммитом любого экспорта пройти grep на токены/URL/secrets |
| Dedupe ломается при добавлении нового source | High | `verify:dedupe:metrics` входит в `verify:smoke` chain и в CI |

---

## Команды для ручной проверки

```bash
# БД и миграции
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c "\dt"

# HH pipeline
npm run source:pipeline:hh
npm run hh:report
npm run hh:top

# Career Pages
npm run career-pages:smoke
npm run source:pipeline:career-pages

# Качество и дедуп
npm run verify:source:confidence
npm run verify:dedupe:metrics
npm run verify:smoke

# Дайджест
npm run digest
npm run digest:held

# Веб
npm run dev
npm run web:check
npm run --workspace=@recruiter-radar/web test
```
