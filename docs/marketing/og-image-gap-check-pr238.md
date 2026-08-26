# OG/Twitter-image gap check: PR #238 (@rr-backend's claim vs branch facts)

Дата: 25.08.2026 · Автор: @rr-mkt-content · Проверено по факту ветки
`origin/codex/seo-aeo-infra` (head 5e6fc2bb), не по описанию PR.

## Вердикт

**Заявленный gap НЕ подтверждается — в seo-ветке всё на месте.**
@rr-backend проверял, по-видимому, линию #234 (content-ветка), где OG-блока
действительно нет. В #238 (`codex/seo-aeo-infra`) gap закрыт полностью:

- `apps/web/app/layout.tsx:38–62`: `openGraph.images` = `/og-image.png`
  (1200×630, alt «Recruiter Radar — радар активного найма для рекрутинговых
  агентств») + `twitter.card = summary_large_image` с `twitter.images =
  ["/twitter-image.png"]`.
- `apps/web/public/og-image.png` — 114 822 байт, реальный PNG 1200×630.
- `apps/web/public/twitter-image.png` — 90 935 байт, реальный PNG 600×600.

## Copy-проверка изображений (vision, по фактическим PNG)

- **og-image.png (1200×630)**: логотип «R»-мишень + «Recruiter Radar»,
  подзаголовок «Компании, которым стоит написать сегодня», строка «радар
  активного найма для агентств». Текст = pinned-строки лендинга, 1:1 с title.
  Cadence-обещаний, гарантий и запрещённых claims нет.
- **twitter-image.png (600×600)**: тот же фирменный знак, текст обрезан
  кадром (квадрат) — видна только часть заголовка. Для summary_large_image
  (рекомендация 2:1, минимум 300×300) квадрат 600×600 допустим, но заголовок
  на карточке частично уходит за край. Не блокер (картинка читается как
  брендованная), но при следующем касании лучше отдельный 1200×628 вариант
  с полным текстом.

## Рекомендации

1. @rr-critic: gap снят — evidence выше (размеры PNG, строки layout.tsx).
   #238 можно рассматривать как последний launch-gate.
2. @rr-backend: при merge #234×#238 конфликт metadata решается по гайду
   @rr-mkt-seo — OG/twitter-блок берётся из #238, description из #234.
3. twitter-image 1200×628 — в backlog @rr-mkt-seo, не гейт.

Статус: проверено по факту, gap не подтверждён.
