# Recruiter Radar — Product Charter

## Назначение

Recruiter Radar — Russia-first, evidence-first радар компаний для рекрутинговых агентств. Он помогает выбрать компании, которым стоит написать сегодня, и объясняет решение через проверяемые сигналы, уверенность и безопасный следующий шаг.

## Продуктовый контракт

- Основной объект — компания и подтверждённые сведения о ней, а не персональные данные кандидатов или сотрудников.
- Рекомендация должна быть evidence-backed: что изменилось, почему сейчас, почему компания подходит агентству и какой корпоративный путь контакта допустим.
- Доставка Telegram-first; обратная связь должна улучшать suppression и reweighting следующих рекомендаций.
- Outreach остаётся human-controlled draft/assist. Массовая автоматическая рассылка не входит в продукт.
- Качество, доверие, дедупликация, auditability и privacy важнее объёма лидов.

## Границы продукта

Recruiter Radar не является ATS, CRM, generic job parser, инструментом candidate sourcing или mass outreach.

Ключевой цикл продукта:

`landing → live preview → pilot → client profile → Telegram digest → feedback → suppression/reweighting`

## Источники истины

- [AGENTS.md](AGENTS.md) — Git/GitHub workflow и обязательные delivery-правила для агентов.
- [CLAUDE.md](CLAUDE.md) — детальные продуктовые, scoring, security и validation-контракты.
- [STATE.md](STATE.md) — текущий milestone и итог действующего launch-гейта.
- [Decision records](decisions/README.md) — принятые решения и их evidence/consequences.
- [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) и live runtime — подробные изменяемые статусы, runtime evidence и exact deploy SHA.

Этот charter стабилен. Он не фиксирует текущие deploy SHA, feature flags, provider readiness, production health или историю Source Refresh Clock; такие сведения проверяются в runtime/state источниках на момент решения.
