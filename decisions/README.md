# Recruiter Radar Decision Records

Каталог хранит принятые governance, product и architecture решения вместе с их основаниями. Это не changelog и не журнал изменяемых runtime-статусов.

## Формат записи

Каждая запись использует неизменяемый четырёхзначный ID и содержит разделы:

- `ID` — идентификатор вида `0001`;
- `Date` — дата решения в формате `YYYY-MM-DD`;
- `Status` — `Accepted`, `Superseded by NNNN` или `Deprecated`;
- `Context` — проблема и ограничения;
- `Decision` — принятое решение;
- `Evidence` — воспроизводимые ссылки, команды или артефакты без секретов и персональных данных;
- `Consequences` — обязательные следствия, компромиссы и порядок последующих изменений.

Принятую запись не переписывают для изменения смысла. Новое решение получает новый ID и помечает прежнее как superseded.

## Индекс

- [0001 — Governance sources of truth](0001-governance-sources-of-truth.md) — `Accepted`
