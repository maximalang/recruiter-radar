# TODO — завершение MVP

**Связано:** `SPEC.md` (продуктовый контракт), `tasks/plan.md` (фазы и критерии), `tasks/runbook.md` (пошаговый runbook)
**Обновлено:** 2026-05-26

Лёгкий чек-лист исполнения. Детали шагов и критерии приёмки — в `tasks/plan.md`.

---

## P0 — критично для MVP (дедлайн 28.05.2026)

### Фаза A. HH end-to-end → дайджест → Telegram
- [ ] `npm run source:pipeline:hh` против production-like БД
- [ ] `npm run verify:digest:selection` зелёный с реальным `clientProfileId`
- [ ] `npm run digest` доставляет реальный дайджест в Telegram
- [ ] Callback handling пишет `client_digest_org_state`
- [ ] `npm run verify:dedupe:metrics` зелёный после ingest

### Фаза B. Checkout + Onboarding
- [ ] Checkout-форма с валидацией пишет в `client_profiles`
- [ ] `telegram_connect_tokens` issuance + activation работают
- [ ] `npm run --workspace=@recruiter-radar/web test -- telegram-connect` зелёный
- [ ] `clientProfileId` после активации бьётся с `/api/digest`

---

## P1 — расширение источников (дедлайн 30.05.2026)

### Фаза C. Career Pages + Rabota Rossii
- ✅ Создать `packages/db/scripts/career-pages-smoke-targets.json` (10 РФ-компаний)
- ✅ `npm run career-pages:smoke` → `npm run source:ingest:career-pages`
- ✅ `npm run verify:rabota-rossii:smoke` → `npm run source:ingest:rabota-rossii`
- ✅ `npm run verify:dedupe:metrics` — один `org_id` для компании из двух источников

### Фаза D. n8n orchestration
- ✅ HH daily workflow (06:00 MSK)
- ✅ Career Pages daily workflow (07:00 MSK)
- ✅ Digest delivery workflow (08:00 MSK)
- ✅ Operational alerts на failures
- ✅ Двое суток подряд успешных executions

---

## P2 — рост покрытия (дедлайн 02.06.2026)

### Фаза E. LinkedIn + Tech Job Boards
- [ ] Закрыт Open Question #3 (выбран LinkedIn provider) — см. `SPEC.md` §10
- [ ] `LINKEDIN_PROVIDER_API_TOKEN` сконфигурирован
- [ ] `npm run verify:linkedin-company-pages:smoke` зелёный
- [ ] `npm run verify:tech-job-boards:smoke` зелёный + ingest
- [ ] `npm run verify:mixed-ranking` зелёный

### Фаза F. UI/UX polish
- [ ] Лендинг: основной CTA + evidence-first копирайт
- [ ] Dashboard: статистика, история дайджестов, настройки
- [ ] Mobile responsive до 320px
- [ ] Lighthouse mobile Performance ≥ 85, Accessibility ≥ 90 на landing и dashboard

---

## Метрика прогресса

| Этап | Завершено | В работе | Ожидание |
|------|:---------:|:--------:|:--------:|
| База данных | ✅ | | |
| HH pipeline (фаза A) | | 🔄 | |
| Checkout + Onboarding (фаза B) | | 🔄 | |
| Sources P1 (фаза C) | | | ⏳ |
| n8n (фаза D) | | | ⏳ |
| LinkedIn / Tech (фаза E) | | | ⏳ |
| UI/UX (фаза F) | | | ⏳ |

---

## Команды для проверки

```bash
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c "\dt"

# HH
npm run source:pipeline:hh
npm run hh:report

# Career Pages
npm run career-pages:smoke
npm run source:pipeline:career-pages

# Качество
npm run verify:source:confidence
npm run verify:dedupe:metrics
npm run verify:smoke

# Дайджест и веб
npm run digest
npm run dev
npm run web:check
```
