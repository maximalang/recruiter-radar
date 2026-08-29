# 0001 — Governance sources of truth

## ID

`0001`

## Date

`2026-08-29`

## Status

`Accepted`

## Context

Продуктовые правила, gate status и изменяемые production-факты имеют разный жизненный цикл. Их дублирование в нескольких документах создаёт stale claims: старый deploy SHA, прошедший CI или наличие кода могут ошибочно выглядеть как текущая live-готовность или разрешение на продажу.

## Decision

Применять следующую иерархию источников истины:

1. [AGENTS.md](../AGENTS.md) и [CLAUDE.md](../CLAUDE.md) — обязательные workflow, product, scoring, security и validation-контракты.
2. Корневые [CHARTER.md](../CHARTER.md) и [STATE.md](../STATE.md) — стабильные границы продукта и текущий итог milestone/gate.
3. [Decision records](README.md) — принятые решения, их evidence и consequences; запись не может переопределять источники более высокого уровня.
4. [docs/CURRENT_STATE.md](../docs/CURRENT_STATE.md) и live runtime — подробные и изменяемые статусы. Для текущего deploy SHA и runtime health используется актуальное live evidence; датированный документ не превращает прошлый runtime-факт в вечный.

Runtime evidence может подтвердить условие gate, но не меняет итог gate автоматически: итог становится новым только после принятия evidence и явного обновления `STATE.md`.

## Evidence

- [AGENTS.md](../AGENTS.md) отделяет workflow-правила от продуктового канона и требует проверяемые SHA/check evidence.
- [CLAUDE.md](../CLAUDE.md) фиксирует продуктовую идентичность, privacy, validation и различение code/CI/deploy/live уровней.
- [docs/CURRENT_STATE.md](../docs/CURRENT_STATE.md) уже требует связывать production-статусы с указанными SHA, workflow run и live-проверками и получать текущий deploy SHA из runtime health.
- [CHARTER.md](../CHARTER.md) исключает изменяемые production claims из стабильного product charter.
- [STATE.md](../STATE.md) фиксирует `Launch readiness` и `SALE / REVENUE CLAIM: BLOCKED` до принятия всего обязательного evidence.

## Consequences

- Новые стабильные продуктовые границы согласуются с `CHARTER.md` и верхнеуровневыми правилами.
- Изменение launch/sale gate отражается в `STATE.md` только с принятым воспроизводимым evidence.
- Exact SHA, flags, provider/source readiness, Clock history и live health обновляются в `docs/CURRENT_STATE.md` или runtime evidence, а не копируются в charter/decision narrative.
- При конфликте сначала применяется эта иерархия; stale документ не повышает уровень готовности.
- Решение не меняет runtime, deploy, permissions, secrets или public state.
