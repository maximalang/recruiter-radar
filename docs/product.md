# Recruiter Radar Product Contract

## Что это

Recruiter Radar — premium Russia-first client-intelligence radar для рекрутинговых агентств.

Продукт помогает агентствам находить компании, которым стоит написать сейчас: по hiring signals, evidence bundle, FIUR scoring, confidence gates, Telegram digest и feedback loop.

Публичный вход — self-serve radar: пользователь видит live preview, запускает pilot, подключает Telegram и получает ежедневный радар. Операционная модель качества — hybrid quality machine: automation by default, human review only for risky/high-value cases until precision is stable.

## Для кого

Основной пользователь — рекрутинговое агентство или boutique search team, которое продаёт подбор B2B-клиентам и хочет находить компании с актуальным окном спроса.

Фокус не на candidate workflow, а на client opportunities: какие компании сейчас имеют доказуемый hiring need, почему это важно, почему это подходит конкретному агентству и какой безопасный следующий шаг возможен.

## Что это не

Recruiter Radar не должен превращаться в:

- ATS
- CRM
- generic job parser
- mass outreach tool
- candidate sourcing product

Не добавлять функции, которые просто увеличивают объём лидов без улучшения evidence, confidence, dedupe, feedback, delivery, billing, trust, security, activation или conversion.

## Core loop

```text
Landing → live preview → pilot activation → client profile → Telegram connection → daily digest → feedback buttons → suppression/reweighting → better future digests
```

## Что должен делать MVP

1. Принимать профиль клиента/агентства: ниши, роли, регионы, include/exclude, delivery settings.
2. Получать hiring signals из one primary jobs source и подготовленных high-signal expansion sources.
3. Нормализовать компании и evidence, не смешивая разные юрлица/домены без уверенного entity match.
4. Считать explainable score по FIUR.
5. Применять confidence gates и negative signals.
6. Собирать per-client digest без дублей и повторов.
7. Отправлять короткие actionable лиды в Telegram.
8. Принимать feedback state (`accepted`, `badfit`, `dismissed`, `snooze`, `contacted`, `replied`, `won`) и использовать его для suppression/reweighting будущих дайджестов.

## Lead quality contract

Каждая рекомендация должна отвечать:

1. Кто компания?
2. Что изменилось?
3. Почему сейчас?
4. Почему это подходит профилю агентства?
5. Какие evidence это подтверждают?
6. Какой безопасный lawful contact path есть?
7. Что пользователь должен сделать дальше?

Обязательные элементы lead card:

- company display name
- legal/company identity when available
- evidence bundle
- FIUR score breakdown
- confidence gate
- negative signals / risks
- why now
- best angle
- safe next action
- feedback/delivery state

## FIUR scoring

FIUR — базовая explainable модель приоритизации:

```text
Total Score = Fit + Intent + Urgency + Reachability
```

- **Fit** — соответствие ICP агентства: индустрия, функция/роль, seniority, регион, размер компании, exclusions.
- **Intent** — реальность hiring need: свежие вакансии, hiring burst, direct company surface, подтверждение из источников.
- **Urgency** — правильное окно сейчас: burst pattern, расширение, hard-to-fill roles, корпоративное событие.
- **Reachability** — безопасный путь контакта: сайт компании, career page, generic HR/contact route, role-based corporate contact path.

Вакансия internal recruiter/TA сама по себе не является hot signal. Она может усиливать кейс только вместе со сложным или широкофункциональным hiring burst.

## Confidence gates

| Gate | Условие | Действие |
|---|---|---|
| A | 2+ independent evidence layers, clean entity match, direct company surface or official API | Auto-deliver |
| B | 1 strong source + enrichment/corroboration layer | Auto-deliver with confidence label |
| C | Platform-only aggregation or questionable entity match | Review before delivery |
| D | Context without direct hiring proof | Do not create lead; store as supporting context |

## Evidence-first rules

- AI is not source of truth; evidence is.
- Direct company hiring proof beats platform aggregation.
- Registry/reference data validates identity and trust, but does not create hiring intent alone.
- Context-only signals can explain urgency, not manufacture a lead.
- Multiple weak signals do not override one strong direct signal.
- Negative signals and confidence gates matter as much as activity.
- Outreach text, if generated, is draft/assist only. No auto-send by default.

## Phased expansion strategy

### Phase 1 — доказать ценность на primary platform + company surface (реализовано)

Два параллельных runnable source в production:
- `hh` — primary platform source, участвует в digest selection
- `career-pages` — company-surface high-signal source, участвует в digest selection

Оба прошли quality-first semantics: evidence tier, confidence, dedupe, suppression, entity resolution.

### Phase 2 — растёт покрытие и добавляется evidence layering

Источники runnable, но ещё не в digest selection — на этапе роста покрытия:
- `linkedin-company-pages` — secondary platform evidence, corroborating layer в digest
- hosted ATS coverage — concrete provider IDs discovered and ingested through `career-pages`; the former `tech-job-boards` pseudo-source is retired and read-compatible only

### Phase 3 — добавить enrichment/context sources (реализовано, не в selection)

Источники, которые не создают лид сами по себе, но улучшают приоритизацию и объяснение:
- `company-site` — сайт компании для контактов, ICP-контекста и дополнительного подтверждения
- `egrul-fns` — ЕГРЮЛ / ФНС для юридических данных компании и entity validation
- `funding-business-signals` — funding, growth и другие business signals для explanation/context layering

## Monetization posture

Позиционирование: automatic self-serve radar.

Операционное качество: hybrid quality machine.

Монетизация:

- self-serve pilot as entry
- assisted radar as core paid offer
- premium desk for high-touch accounts

## Что не делаем сейчас

- Сложную ATS/CRM аналитику
- Candidate sourcing workflow
- Mass outreach или auto-send
- Одновременный запуск многих primary sources в первом релизе
- Большую админку ради админки
- AI-generated facts без evidence
