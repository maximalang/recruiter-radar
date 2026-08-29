# Recruiter Radar — Gate State

**Обновлено:** 2026-08-29

## Текущий milestone

**Launch readiness**

## Итог gate

**SALE / REVENUE CLAIM: BLOCKED**

Заявлять Recruiter Radar готовым к продаже или фиксировать revenue нельзя, пока одновременно не принято воспроизводимое evidence по всем четырём условиям:

1. backups;
2. live-proof;
3. lineage/replay;
4. семь последовательных чистых дней Source Refresh Clock.

Отсутствующее, устаревшее или невоспроизводимое evidence по любому условию оставляет gate в состоянии `BLOCKED`. Успех одного уровня — code, CI, deploy или отдельный live probe — не доказывает остальные уровни.

## Где проверять evidence

- Подробные датированные статусы и ссылки на проверки: [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md).
- Текущий exact deploy SHA и runtime health: live `/api/health`, включая `version.deploySha`.
- Стабильные границы продукта: [CHARTER.md](CHARTER.md).
- Правила проекта и проверок: [AGENTS.md](AGENTS.md) и [CLAUDE.md](CLAUDE.md).
- Принятые governance-решения: [decisions/README.md](decisions/README.md).

Этот файл хранит итог milestone/gate, но не копирует изменяемые production-детали. Изменение gate требует принятого evidence и явного обновления `STATE.md`.
