# Stage 1 AI-Assist — детерминированная синтезация поверх доказательств

> **Дата:** 2026-06-27. **Статус:** спека сессии (реализуется в этой сессии).
> **Companion / уточняет:** `2026-06-27-delivery-paths-and-ai-roadmap.md` §D Stage 1.
> **Границы (наследуются):** не ослабляем evidence-first; не трогаем FIUR
> additive-контракт, confidence-gates, billing, org identity, suppression,
> секреты. AI — **assist поверх** детерминированного ядра, никогда не замена.

## Сдвиг приоритета относительно S4 roadmap

S4 §D определял Stage 1 как «переписать текст opener/best-angle». **Приоритет
уточнён:** Stage 1 в этой сессии — это **детерминированная синтезация для
понятности лида** (fit-объяснение + company/hiring summary) и **чистая граница
`lib/ai/` без LLM**, заточенная под *будущее качество и количество лидов*
(интерпретация сигналов, заполнение структурных пробелов, восстановление слабых
сигналов, ранжирование) — **а не** под генерацию сообщений рекрутёру.

- Меньше «AI для черновиков». Больше «AI позже для качества/количества лидов».
- В этой сессии **LLM не подключается.** Никаких внешних вызовов и зависимостей.
- Outreach уже детерминирован (`lib/outreach-templates.ts`) — остаётся как есть.

## 1. Objective

Сделать каждый лид самообъяснимым из уже имеющихся данных:

- **«Почему этот лид вам подходит»** — детерминированное, profile-aware
  объяснение fit: совпавшие индустрии, роль/сигнал найма, регион/remote-fit,
  соответствие contact-policy, reachability, какие исключения обойдены.
- **Сводка о компании / найме** — детерминированная синтезация того, что уже
  известно (чем компания выглядит, какое движение по найму идёт, почему это важно
  агентству). При слабых доказательствах говорит **меньше**, не выдумывает.
- **Граница `lib/ai/`** — типизированный слой без зависимостей: контракт
  «AI может / AI не может» как код+комментарии, и типы будущих хуков, нацеленных
  на качество лидов (а не на копирайтинг).

**Целевой пользователь:** оператор РФ-рекрутингового агентства в `/leads` и
карточке лида.

**Вне scope сессии:** живые LLM-вызовы, AI-копирайтинг, новая scoring-логика,
изменения схемы БД, новые источники.

## 2. Acceptance Criteria

A. Детерминированное **fit-объяснение** в карточке лида (detail, primary) и в
   компактной форме на lead card. Каждая строка опирается на существующий
   `ScoringReason.key` и/или совпадение поля профиль↔лид — без выдумок.
B. Детерминированная **сводка компания/найм** в lead detail. При слабых
   доказательствах (gate C/D, один источник, нет ролей) деградирует до короткой
   честной строки — не «надувается».
C. `lib/ai/` существует: `boundary.ts` (контракт AI-may / AI-may-NOT как код +
   `assertNoOverride`-гард), `assist-types.ts` (типы будущих хуков:
   explanation-enhance, gap-enrich, intent-classify, weak-signal-extract —
   только интерфейсы), `index.ts` (re-exports). Без внешних зависимостей и сети.
D. Билдеры fit/summary — **чистые функции** `(lead, profile)` → структура; UI
   рендерит структуру, билдеры не возвращают JSX.
E. Outreach без изменений (или минимально).
F. `npm run web:check` зелёный. Новые билдеры покрыты focused-юнит-тестами.
   Scoring/gate-тесты не трогаются.
G. Mobile-first, light-only, переиспользует примитивы `internal-page`.

## 3. Структура (новое / затронутое)

```
apps/web/lib/ai/
  boundary.ts          # AI_CAPABILITIES / AI_PROHIBITIONS + assertNoOverride
  assist-types.ts      # типы будущих хуков (только интерфейсы, без реализации)
  index.ts             # re-exports

apps/web/lib/leads/
  fit-explanation.ts   # buildFitExplanation(lead, profile) → FitExplanation
  company-summary.ts   # buildCompanySummary(lead) → CompanySummary

apps/web/app/leads/[id]/page.tsx   # рендер fit + summary карточек
apps/web/app/leads/page.tsx        # компактная строка «почему подходит» на LeadCard

apps/web/src/__tests__/lib/leads/fit-explanation.test.ts
apps/web/src/__tests__/lib/leads/company-summary.test.ts
apps/web/src/__tests__/lib/ai/boundary.test.ts
```

**Данные уже есть** (новых запросов не нужно): `LeadItem`/`LeadDetail` несут
`confidenceGate`, `evidenceTitles`, `sourceFamilies`, `locationNames`,
`vacanciesCount`, `distinctVacancyNamesCount`, `lawfulContactPath`,
`negativeSignals`, `orgDomain`/`careerPageUrl`, `whyNow`, `bestAngle`.
`ClientProfile` несёт `industries`, `roles`, `excludedIndustries`,
`excludedLocations`, `contactPolicy`, `remoteFriendly`, `targetCity`,
`specialization`. Fit-объяснение матчит эти две стороны.

> **Структурные reasons.** `LeadDetail.reasons` сегодня — только
> форматированные строки. Fit-билдеру нужны структурные `ScoringReason[]`
> (`component`+`key`+`params`). Решение: добавить `structuredReasons:
> ScoringReason[]` в `LeadItem`, заполнять в `mapLeadRow` из уже читаемого
> сырого столбца `reasons` — аддитивно, без изменения SQL. Билдер деградирует,
> если поле пустое (легаси-строки).

## 4. Code Style

- TS strict, маленькие чистые функции, без новых зависимостей.
- Билдеры возвращают структуру (`{ lines: FitLine[], … }`), не JSX.
- Русский: конкретно, premium. Запрещено: «гарантированные клиенты»,
  «100% результат». Предпочтительно: «совпадает с вашим ICP», «сигнал найма»,
  «безопасный путь контакта».
- Каждая строка fit/summary трассируется к конкретному входу — через поле
  `basis` в возвращаемой строке (для теста и для честности).

## 5. Testing Strategy

- `fit-explanation.test.ts`: industry match/exclusion, role match, регион +
  remote-friendly, contact-policy fit, exclusions-avoided, пустые доказательства.
  Проверять: каждая строка имеет корректный `basis` и НИ ОДНА строка не
  появляется без поддерживающего входа.
- `company-summary.test.ts`: rich vs weak (gate D, один источник, ноль ролей) →
  короткий честный вывод; ни одного утверждения без поля.
- `boundary.test.ts`: `assertNoOverride` отклоняет попытку мутировать
  score/gate/evidence; контракт capability/prohibition заморожен и полон.
- `npm run web:check`. Scoring/gate-сьюты не трогать.

## 6. Boundaries

**Всегда:** строить fit/summary только из существующих доказательств+профиля; AI
— строго вторичный слой над evidence; деградировать (говорить меньше) при слабых
доказательствах.

**Спрашивать:** подключение реального LLM / AI-SDK-зависимости; любые изменения
FIUR / gates / entity resolution / suppression; изменения схемы БД.

**Никогда:** позволить AI (сейчас/в будущем) менять gate, FIUR score или сырые
доказательства; выдумывать компании/роли/индустрии/контакты; обходить
`contactPolicy`; коммитить секреты; читать `.env*`/`node_modules/`/`.next/`.

## 7. Definition of Done (сессия)

- Детерминированное fit-объяснение в `/leads` detail (+ компактно на карточке).
- Детерминированная сводка компания/найм в lead detail.
- `lib/ai/` с контрактом capability/prohibition + типами будущих хуков, без LLM.
- Focused-тесты зелёные; `web:check` зелёный; scoring/gate не тронуты.
- Память/бэклог обновлены: DB-хостинг отложен; Railway — путь доступа к БД;
  Stage 1 детерминированный AI-assist отгружен; следующая AI-фаза =
  качество/количество лидов (интерпретация сигналов, gap-filling, восстановление
  слабых сигналов, ранжирование), не копирайтинг.

## 8. Связанные документы

- AI roadmap: `2026-06-27-delivery-paths-and-ai-roadmap.md` §D.
- Родительская спека: `2026-06-27-client-product-system.md`.
- Контракты: `CLAUDE.md` (FIUR, confidence-gates, security).
- Точки интеграции: `apps/web/lib/leads-data.ts` (derive-функции, `mapLeadRow`),
  `apps/web/lib/clientProfiles.ts` (`ClientProfile`),
  `apps/web/lib/scoring/scoring-reasons.ts` (`ScoringReason`, `REASON_LABELS`).
