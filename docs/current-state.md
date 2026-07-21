# Recruiter Radar — текущее состояние runtime

**Обновлено:** 2026-07-21  
**Назначение:** компактная runtime-grounded точка входа перед изменениями и аудитами.

При конфликте документации применяются `AGENTS.md` / `CLAUDE.md`, затем `SPEC.md`, затем фактический runtime-код. Датированные specs, task-файлы и launch notes являются историческими, если прямо не указано обратное.

## Product core

- Next.js/Node.js и PostgreSQL владеют scoring, confidence, entity resolution, digest state, feedback, suppression, billing entitlement и notification state.
- FIUR остаётся аддитивным контрактом `[0,4]`: `Fit + Intent + Urgency + Reachability`.
- LLM может только сжимать и классифицировать уже существующее evidence; он не создаёт факт найма и не обходит confidence gate.
- Персональные email/телефоны не являются стандартным источником данных. Предпочтителен корпоративный lawful contact path.

## Production orchestration

- Ежедневный запуск выполняет VPS cron через `POST /api/cron/daily-radar` с `CRON_API_KEY`.
- Retry notification jobs запускаются через `POST /api/cron/notification-delivery-retry`.
- n8n не развёрнут как обязательная часть production и не владеет бизнес-логикой. Signed webhook может использоваться клиентом для собственного n8n-сценария, но это delivery endpoint, а не product orchestration.
- Production deploy запускается только после успешного workflow `Tests` и использует проверенный SHA. Предыдущий Docker image сохраняется для rollback; destructive `docker image prune -af` запрещён.

## Delivery channels

Notification platform поддерживает:

- customer-managed Telegram bot;
- legacy shared Telegram fallback;
- VK community;
- email digest;
- browser push;
- signed HTTPS webhook.

Активный профиль участвует в daily radar, если `delivery_enabled=true` и существует хотя бы один пригодный канал. Entitlement, tenant boundary, retries, idempotency и dead-letter решения проверяются server-side.

## Source registry semantics

`status: active` означает, что source зарегистрирован и имеет runnable contract. Это **не** означает одновременно live-configured, legally approved и digest-allowed.

Используются отдельные признаки:

- `maturity` — фактическая стадия готовности;
- `leadEligibility` — может ли источник создавать lead evidence;
- `promotionStatus` — допущен ли источник в digest;
- `productionBlockers` — обязательные внешние/quality ограничения;
- live configuration — присутствуют ли реальные credentials/config и проходит ли live verifier.

| Source | Роль | Promotion state |
|---|---|---|
| `hh` | primary hiring evidence | `digest-allowed`, controlled live checks required (real `HH_USER_AGENT` is an external blocker) |
| `rabota-rossii` | official primary evidence | `digest-allowed`, freshness/confidence gated |
| `career-pages` | direct company hiring surface | `digest-allowed`, controlled discovery coverage required |
| `habr-career` | secondary hiring evidence | `digest-allowed`-gated candidate; full-automatism (scraped, no partner API, keywords derived from profile ICP). Live-public when DB has active profiles; pending confidence tests for promotion |
| `egrul-fns` | legal entity enrichment | `never-lead-originating`; full-automatism — INNs derived from DB orgs needing registry verification (10-digit юрлицо, `ogrn IS NULL`) |
| `transparent-business-fns` | registry enrichment | `never-lead-originating`, approved provider/snapshot required |
| `fedresurs` | business context | `never-lead-originating`, compliant provider required |
| `company-site` | company enrichment/corroboration | `supporting-evidence-only`; full-automatism — crawl targets derived from DB orgs the radar already tracks (domain + hiring signal, `NOT EXISTS` a company-site signal) |
| `funding-business-signals` | business context | `never-lead-originating`; full-automatism — GDELT queries derived from active profiles' ICP industries (free, no key) |
| `linkedin-company-pages` | secondary platform evidence | blocked pending compliant provider and confidence tests |
| `tech-job-boards` | secondary hiring evidence | live-public via public ATS manifests (Greenhouse/Lever); operator lists board tokens/slugs — board identifiers, not secrets, but not DB-derivable, so still operator-curated. Pending confidence tests for promotion |
| `superjob` | secondary hiring evidence | blocked pending API/provider and confidence tests |
| `company-newsrooms` | curated context | `never-lead-originating`; full-automatism — newsroom crawl targets derived from DB orgs (same contract as company-site, `NOT EXISTS` a company-newsrooms signal) |
| `industry-media` | curated context | `never-lead-originating`; operator INPUT_FILE or provider feed only (no free live crawl) — pending compliant provider/manual review |
| `regional-job-boards` | regional hiring evidence | blocked pending per-board legal/provider review |

Точный список и policy берутся из `packages/db/scripts/source-registry.mjs`; фиксированное число источников в narrative docs не является контрактом.

`full-automatism` в таблице означает, что источник выводит свой live-public input из DB/профилей без ручной кураторской ENV и без платного ключа — операторский override всегда выигрывает. Это **не** production-live-ready само по себе: такие источники производят записи только когда DB достаточно населена (orgs/профили/сигналы), а первичные источники всё ещё требуют реальных credentials (например `HH_USER_AGENT`). Честный live-config статус проверяется `verify:sources:live-config`, а не статусом в таблице.

## Payment state

- Публичные цены указаны в RUB.
- Runtime payment adapter сейчас реализован только для Stripe.
- Недельный pilot может быть self-serve только при реально настроенном provider/webhook/entitlement контуре.
- Monthly и quarterly без полноценного recurring provider обрабатываются как sales request и не должны называться активной автоподпиской.
- Российский provider не считается готовым до выбора провайдера, реальных credentials, sandbox/live webhook проверки, требований к чекам/возвратам и юридического review.

## Observability state

Есть:

- `/api/health`;
- GitHub Actions tests/build/Docker smoke;
- source readiness/coverage/confidence verifiers;
- durable digest/delivery attempt history;
- notification audit log и dead-letter state;
- operator scripts, включая source/digest reports.

Пока нет подтверждённого внешнего production observability-контура с SLO, централизованными метриками, alert routing и долгосрочным trace/log retention. Это остаётся внешним operational blocker, а не скрытой «готовой» возможностью.

## External blockers

Код не может заменить:

- реальные production secrets и provider credentials;
- зарегистрированный идентифицируемый `HH_USER_AGENT` и controlled live matrix;
- legal/robots/provider approval для ограниченных источников;
- production Redis/общий distributed rate-limit store, если запускается более одного instance;
- выбранный RF payment provider, договор, чеки, refund/cancellation process;
- внешний monitoring/alerting backend;
- размеченный anonymized gold set для объективной оценки FIUR precision.

## Обязательная проверка перед заявлением readiness

```bash
npm run guard:router
npm run web:check
npm run web:build
npm test --workspace @recruiter-radar/web
npm run db:validate
npm run verify:smoke
npm run verify:sources:readiness
npm run verify:sources:coverage
npm run verify:source:confidence
npm audit --omit=dev --audit-level=high
```

Live-ready утверждение дополнительно требует production-shaped env и `verify:sources:live-config`. Отсутствующий внешний prerequisite должен отображаться как blocker, а не заменяться fixture или optimistic status.
