# SPEC — Delivery paths #1 (Web-push) и #2 (Email digest)

> Дата: 2026-06-27. Сессия строго про **доставку**. Никакого AI, новых источников,
> рефакторинга скоринга или архитектуры entity-resolution. Telegram / in-app / CSV
> уже сделаны. Этот документ — single source of truth для текущей сессии; верхнеуровневый
> `SPEC.md` и `CLAUDE.md` остаются вышестоящим контрактом.

---

## 1. Objective

Добавить два следующих канала доставки лидов поверх **уже существующего**
единого digest-pipeline, не форкая правила отбора:

1. **Web-push** — мгновенный сигнал «появились новые сильные лиды» в браузере.
2. **Email digest** — один премиальный дайджест в день на профиль, evidence-first,
   та же продуктовая история, что Telegram/in-app.

Целевые пользователи: агентства-пилоты, уже получившие ценность в продукте
(прошли онбординг, видят `/leads`) и желающие узнавать о новых лидах, не открывая приложение.

**Definition of done:** оба канала работают end-to-end; пользователь может включить/выключить
каждый; триггеры переиспользуют `digest_candidates`/`client_digest_org_state`; нет повторного
спама по одной орге; всё проходит pre-merge gate из CLAUDE.md.

---

## 2. Что уже есть (результат аудита) — НЕ форкать

Единый pipeline доставки (использовать как есть):

- **`runDigestForClientProfile`** (`apps/web/lib/digest.ts`) — отбирает кандидатов
  (gate/profile-match/cooldown/suppression уже в SQL: исключает `contacted/replied/won`,
  `suppressed_until > NOW()`, `cooldown_until > NOW()`), пишет `digest_candidates` +
  `client_digest_org_state`. **Единственный источник «новый eligible lead».**
- **`sendLeadToTelegram`** (`apps/web/lib/db.ts`) — читает `digest_candidates` по id, шлёт.
- **`/api/digest`** (POST-триггер прогона), **`/api/hh/digest`** — за `x-api-key`.
- Таблицы: **`digest_candidates`** (run_id, client_profile_id, org_id, payload,
  confidence_gate, …), **`client_digest_org_state`** (cooldown_until, suppressed_until,
  feedback_status).

Web-push сейчас — **только заглушки**: `webPushSubscriptions.ts` и `webPushConnect.ts`
всегда возвращают `configured:false`; `BrowserPushCard` рендерит плейсхолдер в онбординге.
Нет таблицы, VAPID, service worker, клиентской подписки, триггера.
(`Subscription` interface — это биллинг, НЕ push.)

Email — **ничего**, только заметка в `memory/mvp-checklist.md` → выбран nodemailer/SMTP.

**Архитектурное решение:** оба новых канала потребляют ТЕ ЖЕ `digest_candidates`.
Дедуп per-channel — в новой таблице `lead_channel_deliveries`, чтобы не дублировать отправку
и не трогать общий `client_digest_org_state`.

---

## 3. Объём сессии (подтверждён пользователем)

- Web-push: **полный e2e** — миграция, VAPID, service worker, клиентская подписка
  с 4 состояниями, server-side отправка, триггер после `runDigest`.
- Email: **полная отправка** — премиальный HTML-шаблон, рендерер, send-route/job,
  настройка on/off, дедуп per-profile-per-day, реальная отправка.
- Зависимости: **`web-push`** (VAPID, без внешнего сервиса) + **`nodemailer`**
  (SMTP, провайдер-агностично, работает из РФ).

---

## 4. Deliverables

### A. Миграция БД (`packages/db/migrations`)

```sql
web_push_subscriptions(
  id, client_profile_id FK, endpoint UNIQUE, p256dh, auth,
  created_at, last_seen_at, revoked_at NULL
)

lead_channel_deliveries(
  id, channel TEXT CHECK (channel IN ('web_push','email')),
  client_profile_id FK, digest_run_id FK NULL, digest_candidate_id FK NULL,
  delivered_at, dedupe_key TEXT
  -- UNIQUE (channel, client_profile_id, dedupe_key)
)

ALTER TABLE client_profiles
  ADD COLUMN web_push_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN email_digest_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN digest_email TEXT NULL;
```

Аддитивно, обратносовместимо. Указать, как применять.

### B. Web-push (полный e2e)

- **`lib/webPush.ts`** (заменяет stub): VAPID из env (`WEB_PUSH_PUBLIC_KEY`,
  `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`), `isWebPushConfigured()`,
  `saveSubscription()`, `revokeSubscription()`, `getActiveSubscriptions(profileId)`,
  `sendWebPushToProfile(profileId, payload)` (graceful: 404/410 → `revoked_at`).
- **`public/sw.js`** — service worker: `push` (notification: заголовок, тело,
  `data.url` → `/leads`), `notificationclick` (focus/open `/leads?...`).
- **Клиент** — opt-in компонент (`"use client"`): регистрация SW, `pushManager.subscribe`
  с VAPID public key, POST подписки. 4 состояния: `not_supported`,
  `permission_denied`, `subscribed`, `unsubscribed`.
- **Routes** — `POST /api/push/subscribe`, `POST /api/push/unsubscribe`
  (owner-scoped через сессию, anti-IDOR — профиль из сессии, не из тела).
- **Триггер** — после `runDigestForClientProfile`: если есть новые кандидаты gate A/B
  и `web_push_enabled`, отправить **один агрегированный** push «N новых сильных лидов»,
  записать в `lead_channel_deliveries` `dedupe_key = digest_run_id`. Spam-guard:
  не слать, если по этому run уже доставлено.

### C. Email digest (полный e2e)

- **`lib/email/transport.ts`** — nodemailer SMTP из env
  (`SMTP_HOST/PORT/USER/PASS/FROM`), `isEmailConfigured()`, `sendEmail()`.
- **`lib/email/digestEmail.ts`** — чистый рендерер HTML (тестируемый без сети):
  header/intro → топ-лиды (A/B первыми) → на лид: компания, why now, сигнал,
  gate/confidence, corporate surface/contactability, ссылка в приложение →
  footer (саммари профиля + ссылка на настройки). `escapeHtml` на каждой строке.
  Переиспользует `deriveWhyNow`, `deriveLawfulContactPath` (как Telegram).
- **Триггер (как реализовано)** — НЕ отдельный `POST /api/email/digest`, а
  best-effort вызов `sendDigestEmailForProfile({ clientProfileId, digestRunId })`
  внутри `deliverCandidatesForRun(runId)`, рядом с web-push. Единый authenticated
  вход — `POST /api/digest/delivery` (`x-api-key`), который запускает прогон и
  доставляет по всем каналам одним run-scoped проходом. Для профиля с
  `email_digest_enabled && digest_email`: взять кандидатов **этого run**
  (`getLeadsForAllProfiles({ digestRunId })`), оставить gate A/B, отрендерить,
  claim-before-send в `lead_channel_deliveries` `dedupe_key = day:<YYYY-MM-DD>`
  (первый пишущий выигрывает) → одно письмо/профиль/день.
- **Почему run-scoped, а НЕ «все сегодняшние кандидаты»** — email обязан брать
  кандидатов конкретного run (`digest_run_id`), а не всю историю профиля: иначе
  «дневной» дайджест накапливал бы устаревших кандидатов всех прошлых run и
  расходился бы с Telegram/web-push. (Это поймал review как Critical; `digestRunId`
  на `sendDigestEmailForProfile` сделан обязательным, чтобы регресс был
  невозможен по типу.)
- **Почему НЕ отдельный route** — standalone `/api/email/digest` пришлось бы
  кормить кандидатами вне run-контекста, что воспроизвело бы ту же ошибку
  накопления. Один общий `deliverCandidatesForRun` держит все каналы
  консистентными.

### D. Настройки (UX) — в `/settings/profile` (owner-scoped, уже есть)

Секция «Доставка»:
- Web-push opt-in (4 состояния, копия «Получать мгновенные сигналы о новых сильных лидах»).
- Email digest: чекбокс on/off + поле email + явная частота «Ежедневно».
- Сохранение через server action (валидация email, anti-IDOR).

### E. Документация триггеров

- **Единый вход доставки** — `POST /api/digest/delivery` (`x-api-key`): прогон
  (`runDigestForClientProfile`) + `deliverCandidatesForRun(runId)`, который
  фан-аутит на Telegram (per-candidate, idempotency `digest:<run>:candidate:<id>`),
  web-push и email. Cron бьёт по одному этому route.
- **web-push trigger** = новые сильные лиды (A/B) после прогона (event-driven),
  один агрегат на run, dedupe `run:<digest_run_id>`.
- **email trigger** = run-scoped дайджест внутри того же прогона, idempotent по
  `day:<YYYY-MM-DD>` (один/профиль/день). НЕ отдельный cron — см. секцию C
  «Почему run-scoped / Почему НЕ отдельный route».
- **Почему такой выбор per-channel** — Telegram дробится по кандидатам (нужны
  inline-кнопки на каждый лид); web-push и email агрегируются (нудж «открой
  радар», не спам), но оба скоупятся одним run, чтобы все три канала показывали
  один и тот же свежий набор.
- **SW hardening** — `sw.js` форсит same-origin на target URL в `push` и
  `notificationclick` (`safeSameOriginUrl`, fallback `/leads`): даже форж payload
  не уведёт на чужой origin.

---

## 5. Commands (validation)

- Всегда: `cd apps/web && npm run web:check`
- `npm run web:build` — меняются routes/SW/`public`.
- Тесты: `cd apps/web && npm test` (jest строго из `apps/web` cwd).
- Не зацикливать check/build.

## 6. Testing strategy

- **Чистые юнит-тесты (без сети/БД):**
  - `digestEmail.ts` — рендеринг: A/B первыми, escape, пустой ввод, ссылки, footer.
  - web-push payload builder — агрегированный заголовок «N новых лидов».
  - dedupe-логика — нет повторной доставки по орге/профилю/run/дню.
- **Состояние подписок/предпочтений** — сохранение/отзыв, owner-scope.
- Console-ошибки в негативных тестах (db down, invalid input) — ожидаемы.

## 7. Boundaries

**Всегда:** переиспользовать `digest_candidates`/`client_digest_org_state` как
единственный источник отбора; `escapeHtml` на всех строках из данных компании;
owner-scope (anti-IDOR) на всех route/action подписок и предпочтений; graceful
degradation при пустом env канала (не падать, логировать).

**Спросить сначала:** изменение правил отбора/FIUR/gate/схемы `digest_candidates`;
изменение сигнатур `runDigestForClientProfile`/`sendLeadToTelegram`; зависимости сверх
`web-push` + `nodemailer`.

**Никогда:** форкать pipeline отбора; слать по-лидово (только агрегат: push = N лидов,
email = 1 дайджест/день); слать по орге в cooldown/contacted/suppressed (уже в SQL);
коммитить секреты (VAPID private key, SMTP pass — только `.env.example`); AI / новые
источники / рефакторинг скоринга.

## 8. Pre-merge gate (MANDATORY, из CLAUDE.md)

Миграция + delivery-state — критичные зоны. Перед push: `/review` (5 осей),
`codegraph_impact` на изменённые экспорты, signature-diff, DDD
(CLAIM→EXTRACT→DOUBT→RECONCILE→STOP) для миграции и дедуп-логики.
Push только по явной команде пользователя.
