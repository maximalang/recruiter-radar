# Runbook: верификация и доработка MVP

**Версия:** 1.0
**Обновлено:** 2026-05-26
**Связано:** `SPEC.md`, `tasks/plan.md`, `tasks/todo.md`

Пошаговый runbook к фазам A–F из `tasks/plan.md`. Каждый шаг содержит:
- **Команду** (точная)
- **Ожидаемый выход** (что увидеть, чтобы шаг считался успешным)
- **Если падает** (что проверить)

---

## 0. Предусловия (проверить однократно)

| # | Команда | Ожидаемый выход |
|---|---------|-----------------|
| 0.1 | `node --version` | `v20.x` или выше |
| 0.2 | `npm --version` | `10.x` или выше |
| 0.3 | `docker compose ps` | `recruiter-radar-db-1` running, `n8n` running |
| 0.4 | `npm install` | exit 0, no `npm audit` blockers |
| 0.5 | `npm run web:check` | exit 0 |
| 0.6 | `npm run --workspace=@recruiter-radar/web test` | `Tests: 178 passed, 178 total` (или больше) |
| 0.7 | `cat .env \| head -3` (локально, не коммитить) | `DATABASE_URL=...`, `SESSION_SECRET=...`, `TELEGRAM_BOT_TOKEN=...` заполнены |

**Если 0.3 пусто:** `docker compose up -d` → подождать 10s → повторить.
**Если 0.5 падает:** см. ошибки tsc, чинить точечно, без массовых рефакторов.
**Если 0.6 падает:** изолировать упавший тест, прогнать с `--testPathPattern=`, починить regression.

---

## Фаза A — HH end-to-end → дайджест → Telegram (P0)

**Дедлайн:** 2026-05-27 EOD
**Пререкизит:** раздел 0 пройден.

### A.1 HH source pipeline

```bash
DATABASE_URL=$DATABASE_URL npm run source:pipeline:hh
```

**Ожидаемый выход:**
- Лог `[fetch-hh] fetched N vacancies` где N ≥ 50
- Лог `[ingest-hh] upserted M orgs, K signals`
- Никаких `ERROR` / `UnhandledRejection`

**Verification:**
```bash
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c \
  "SELECT count(*) FROM org_source_refs WHERE source='hh';"
# ожидание: > 0
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c \
  "SELECT count(*) FROM hh_signals WHERE created_at > now() - interval '1 hour';"
# ожидание: > 0
```

**Если падает:**
- `HH_USER_AGENT` не задан → задать в `.env`
- 429 от HH → подождать 10 минут, повторить с меньшим лимитом
- Ошибка SSL/network → проверить, что VPN не блокирует api.hh.ru

### A.2 Digest selection smoke

```bash
DATABASE_URL=$DATABASE_URL npm run verify:digest:selection
```

**Ожидаемый выход:** `[verify:digest:selection] OK`, exit 0.

**Verification:**
- В БД появилась запись `digest_runs` за последний час
- `digest_candidates` содержит ≥1 строку, привязанную к этому `run_id`
- Все кандидаты с `gate ∈ {A, B}` (gate C/D отфильтрованы)

### A.3 Реальный дайджест в Telegram

```bash
DAILY_DIGEST_CLIENT_PROFILE_ID=<uuid> npm run digest
```

**Ожидаемый выход:**
- Сообщение в Telegram с лидами (формат: company, score, confidence, why now, evidence, best angle, safe action)
- Inline-кнопки активны и кликабельны
- Лог `[digest] delivered N leads to chat <id>`

**Verification:**
- В БД создана запись `digest_runs(status='delivered')`
- Клик по `Беру` → запись `client_digest_org_state(state='accepted')`
- Клик по `Мимо` → `state='badfit'`, через сутки этот org не появляется в digest того же клиента (suppression)

### A.4 Dedupe metrics

```bash
DATABASE_URL=$DATABASE_URL npm run verify:dedupe:metrics
```

**Ожидаемый выход:** exit 0, отчёт показывает 0 дубликатов по `org_id` для одного и того же логического entity.

---

## Фаза B — Checkout + Onboarding (P0)

**Дедлайн:** 2026-05-28 EOD

### B.1 Checkout-форма локально

```bash
npm run dev
```

Затем в браузере: `http://localhost:3000` → пройти checkout с тестовыми данными.

**Verification:**
```bash
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c \
  "SELECT id, agency_name, status, created_at FROM client_profiles ORDER BY created_at DESC LIMIT 5;"
```
Ожидание: новая строка с указанным agency_name, status `trial`.

**Если падает:**
- 400 на submit → проверить validation schema (`lib/secure-validation-schemas.ts`)
- 500 на submit → смотреть логи Next.js dev server, проверить DATABASE_URL пишется

### B.2 Telegram connect token issuance

В UI: нажать «Подключить Telegram» → получить deep-link.

**Verification:**
```bash
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c \
  "SELECT token, client_profile_id, expires_at, used_at FROM telegram_connect_tokens ORDER BY created_at DESC LIMIT 5;"
```
Ожидание: новая строка, `used_at IS NULL`, `expires_at` в пределах 15 минут.

### B.3 Telegram connect token activation

Открыть deep-link через тестовый Telegram аккаунт.

**Verification:**
- Запрос к таблице выше — `used_at IS NOT NULL`
- В UI: онбординг помечает Telegram как подключённый
- Повторный клик на тот же deep-link → ошибка «токен использован»

### B.4 Юнит-тесты telegram-connect

```bash
npm run --workspace=@recruiter-radar/web test -- telegram-connect
```

**Ожидаемый выход:** suite зелёный.

---

## Фаза C — Career Pages + Rabota Rossii (P1)

**Дедлайн:** 2026-05-29 EOD

### C.1 Targets file

Создать `packages/db/scripts/career-pages-smoke-targets.json` со списком 10 РФ-компаний. Формат: см. `career-pages-targets.example.json`. Минимум 3 Greenhouse-board, 3 Lever-postings, 4 json-feed.

**Verification:** `npm run career-pages:smoke` показывает «N targets resolved».

### C.2 Career Pages ingest

```bash
DATABASE_URL=$DATABASE_URL npm run source:pipeline:career-pages
```

**Verification:**
```bash
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c \
  "SELECT count(*) FROM org_source_refs WHERE source='career-pages';"
# ожидание: > 0
```

### C.3 Rabota Rossii pipeline

```bash
npm run verify:rabota-rossii:smoke
DATABASE_URL=$DATABASE_URL npm run source:pipeline:rabota-rossii
```

**Verification:** `org_source_refs WHERE source='rabota-rossii'` пополнилось.

### C.4 Cross-source dedupe

```bash
DATABASE_URL=$DATABASE_URL npm run verify:dedupe:metrics
```

**Ожидаемый выход:**
- Отчёт: для тестового набора одинаковая компания, попавшая через HH + career-pages, имеет один `org_id`
- 0 conflicting refs

**Если падает:** проверить entity-resolution в `packages/db/lib/` — INN/OGRN/domain matching.

---

## Фаза D — n8n daily workflows (P1)

**Дедлайн:** 2026-05-30 EOD

### D.1 Поднять n8n с продакшен-credentials

`docker compose up -d n8n`, открыть `http://localhost:5678`, создать credentials для:
- Postgres (тот же `DATABASE_URL`)
- HTTP (RR-internal API key для webhook auth)

**Никогда:** не экспортировать workflow с реальными токенами. Если экспорт нужен — обнулить credentials.

### D.2 Workflow HH daily

Cron: `0 6 * * *` MSK. Action: HTTP POST на `/api/sources/run` с `{sourceId: "hh"}`.

**Verification:**
- В n8n UI: выполнить workflow вручную → 200, длительность < 5 мин
- В БД: новые `org_source_refs WHERE source='hh' AND created_at > now() - interval '10 minutes'`

### D.3 Workflow Career Pages daily

Cron: `0 7 * * *` MSK. Action: HTTP POST на `/api/sources/run` с `{sourceId: "career-pages"}`.

### D.4 Workflow Digest delivery

Cron: `0 8 * * *` MSK. Action: HTTP POST на `/api/digest/deliver` с `{forAllActiveClients: true}`.

### D.5 Alerts

Workflow `failure-alert`: trigger on any `error` event → POST в operator Telegram chat. Тест: умышленно сломать creds в HH workflow → должен прийти alert.

### D.6 Двухсуточная стабильность

Запустить все три workflow по расписанию. Через 48 часов:
- 6/6 успешных executions (HH × 2, career-pages × 2, digest × 2)
- 0 alerts

---

## Фаза E — LinkedIn + Tech Job Boards (P2)

**Дедлайн:** 2026-06-01 EOD
**Пререкизит:** SPEC.md §10 Open Question #2 закрыт.

### E.1 Provider setup

`.env`: `LINKEDIN_PROVIDER_API_TOKEN=<token>`. Никаких токенов в репозиторий.

### E.2 LinkedIn ingest

```bash
npm run verify:linkedin-company-pages:smoke
DATABASE_URL=$DATABASE_URL npm run source:pipeline:linkedin-company-pages
```

**Verification:** `org_source_refs WHERE source='linkedin-company-pages'` > 0, mixed-ranking держится:

```bash
npm run verify:mixed-ranking
```

### E.3 Tech Job Boards

```bash
npm run verify:tech-job-boards:smoke
DATABASE_URL=$DATABASE_URL npm run source:pipeline:tech-job-boards
```

### E.4 Confidence scoring sanity

```bash
DATABASE_URL=$DATABASE_URL npm run verify:source:confidence
```

**Ожидаемый выход:** для компаний с ≥2 источниками confidence повышается на gate A/B; для одиночных — остаётся B/C.

---

## Фаза F — UI/UX polish (P2)

**Дедлайн:** 2026-06-02 EOD

### F.1 Landing

В браузере прогнать сценарии:
1. Landing → CTA → /onboarding (без пилоэрроров)
2. Mobile viewport 320×568 (DevTools) — нет горизонтального скролла, все CTA touch-friendly (≥44×44 px)
3. Keyboard-only navigation: Tab проходит все CTA в логичном порядке, focus visible

### F.2 Dashboard

В DevTools (logged-in test user):
1. Карточка дайджеста показывает ≥1 лид
2. История дайджестов рендерит ≥7 предыдущих runs
3. Settings → можно изменить industry/specialization

### F.3 Lighthouse

```
Chrome DevTools → Lighthouse → Mobile → Performance + Accessibility
```

**Ожидание:**
- Landing: Performance ≥ 85, Accessibility ≥ 90
- Dashboard: Performance ≥ 85, Accessibility ≥ 90

**Если падает Accessibility:** проверить `aria-label`, контраст, focus styles. См. `agent-skills:frontend-ui-engineering`.

---

## Полный smoke перед релизом

```bash
# 0. Чистый старт
docker compose up -d
npm install

# 1. Static checks
npm run web:check          # tsc --noEmit
npm run web:build          # next build
npm run --workspace=@recruiter-radar/web test   # 178+ green

# 2. DB-backed smoke chain
DATABASE_URL=$DATABASE_URL npm run verify:smoke

# 3. Source-level smoke
npm run verify:career-pages:smoke
npm run verify:career-pages:discovery
DATABASE_URL=$DATABASE_URL npm run verify:career-pages:ingest
npm run verify:rabota-rossii:smoke
npm run verify:tech-job-boards:smoke
npm run verify:linkedin-company-pages:smoke
npm run verify:company-site:smoke
npm run verify:funding-business-signals:smoke

# 4. Quality gates
DATABASE_URL=$DATABASE_URL npm run verify:source:confidence
DATABASE_URL=$DATABASE_URL npm run verify:dedupe:metrics
DATABASE_URL=$DATABASE_URL npm run verify:digest:feedback
DATABASE_URL=$DATABASE_URL npm run verify:digest:selection
npm run verify:mixed-ranking
DATABASE_URL=$DATABASE_URL npm run verify:sources:coverage

# 5. Manual UI smoke
# - Landing CTA → onboarding → checkout → trial subscription создан
# - Telegram connect → бот ответил, токен activated
# - Digest пришёл в Telegram, кнопки работают, feedback пишет state
# - Mobile viewport 320px: нет горизонтального скролла
```

**Все 5 секций зелёные → MVP готов к pilot launch.**

---

## Аварийные процедуры

### Откат БД после неудачной миграции
```bash
# 1. остановить web
docker compose stop web
# 2. восстановить snapshot
docker exec recruiter-radar-db-1 pg_restore -U postgres -d recruiter_radar -c /backups/<latest>.dump
# 3. перезапустить web
docker compose start web
```

### Отключить дайджест на время инцидента
```bash
# В n8n UI: deactivate workflow "Digest delivery"
# В Telegram bot: команда /pause всем активным клиентам (если реализована)
# В БД: UPDATE client_profiles SET digest_paused_at = now() WHERE status='trial';
```

### Если HH API заблокировал по IP
- Подождать 30 минут
- Уменьшить параллелизм в `fetch-hh.mjs`
- Сменить outbound IP (если на VPS)
- Зафейловер на career-pages как primary временно

---

## Чек-лист релиза MVP

- [ ] Раздел 0 (предусловия) пройден
- [ ] Фаза A.1–A.4 зелёные
- [ ] Фаза B.1–B.4 зелёные
- [ ] Фаза C.1–C.4 зелёные
- [ ] Фаза D.1–D.6 зелёные (48 часов стабильности)
- [ ] Фаза E.1–E.4 зелёные ИЛИ Open Question #2 явно отложен
- [ ] Фаза F.1–F.3 зелёные
- [ ] Полный smoke chain выше — все 5 секций exit 0
- [ ] `npm audit` — 0 high/critical
- [ ] `.env*` не закоммичены (`git ls-files | grep -E '\.env'` пусто)
- [ ] Никаких токенов в `n8n-workflows/*.json` экспортах
- [ ] SECURITY.md и docs/SECURITY.md актуальны
- [ ] README.md «Локальный запуск» отрабатывает с нуля у нового разработчика

**Когда все пункты ✅ → MVP go-live.**
