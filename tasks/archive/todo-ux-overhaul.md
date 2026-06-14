# TODO — UX Overhaul

**Связано:** `tasks/plan-ux-overhaul.md` (полный план)  
**Обновлено:** 2026-06-12  
**Фокус:** Единый визуальный язык на всех страницах, 0 inline styles, responsive, a11y

---

## Фаза 1: Foundation

### T1: internal-page.module.css + internal-page.tsx
- [x] Создать `apps/web/app/ui/internal-page.module.css` с токенами и компонентами
- [x] Создать `apps/web/app/ui/internal-page.tsx` с TSX-обёртками
- [x] Компоненты: InternalPageFrame, MetricCard, DataTable, DetailLayout, GateBadgeInline, ScoreGauge, FeedbackButton, FilterSelect
- [x] Все компоненты используют `var(--c-*)`, `var(--fs-*)`, `var(--radius-*)`
- [x] `:focus-visible` на всех interactive
- [x] `prefers-reduced-motion` для анимаций

### T2: leads.module.css
- [x] Создать `apps/web/app/leads/leads.module.css`
- [x] Перенести все стили из inline `leads/page.tsx`
- [x] Классы: leadsPage, leadsHeader, leadsSummaryGrid, leadsTable*, leadRow*, leadsEmpty

---

## Фаза 2: Страницы

### T3: leads/page.tsx — рефакторинг
- [x] Заменить inline styles на CSS-классы из internal-page
- [x] GateBadge → GateBadgeInline из internal-page
- [x] FeedbackBadge → component
- [x] ScoreBar → ScoreBar из internal-page
- [x] Summary cards → MetricCard
- [x] Header → InternalPageHeader
- [x] 0 inline `style={}` (кроме layout-ограничений)
- [x] `npm run web:check` ✅

### T4: dashboard — визуальное выравнивание
- [x] border-radius: `0.5rem` → `var(--radius-card-sm)` / `var(--radius-card)`
- [x] border color: `#e5e7eb` → `var(--c-border)`
- [x] card bg: `white` → `var(--c-bg-card)`
- [x] page bg: `#f9fafb` → `var(--c-bg-page)`
- [x] Убрать 3 inline styles из page.tsx → InternalPageFrame
- [x] Header → InternalPageFrame
- [x] `:focus` → `:focus-visible`
- [x] `npm run web:check` ✅

### T5: checkout — редизайн
- [x] Обернуть в InternalPageFrame
- [x] SurfaceCard (ContentCard) с описанием заказа
- [x] Структурированная кнопка оплаты (ppStyles.primaryAction)
- [x] Back-link (InternalBackLink) на главную
- [x] Responsive
- [x] `npm run web:check` ✅

---

## Фаза 3: Leads-компоненты

### T6: feedback-buttons → CSS модуль
- [x] Создать `feedback-buttons.module.css`
- [x] .feedbackBtn + data-атрибуты (tone, active)
- [x] `:focus-visible`, `:disabled` через CSS
- [x] 0 inline styles
- [x] `npm run web:check` ✅

### T7: outreach-picker → CSS модуль
- [x] Создать `outreach-picker.module.css`
- [x] .templateTab, .renderedTemplate, .actionBtn
- [x] Copied/Sent/Error → data-attributes + CSS
- [x] `:focus-visible`
- [x] 0 inline styles
- [x] `npm run web:check` ✅

### T8: leads-filters → CSS модуль
- [x] Создать `leads-filters.module.css`
- [x] .filterBar, .filterSelect, .filterReset
- [x] `:focus-visible` на select и кнопке
- [x] 0 inline styles
- [x] `npm run web:check` ✅

### T9: leads/[id]/page.tsx — рефакторинг
- [x] Заменить 55 inline styles на CSS-классы
- [x] DetailLayout с responsive collapse (≤768px)
- [x] GateBadge → GateBadgeInline
- [x] ScoreGauge → component
- [x] Negative signals → ContentCard tone="danger"
- [x] `npm run web:check` ✅

---

## Фаза 4: Навигация

### T10: InternalPageFrame + shared nav
- [x] Top nav: [← Recruiter Radar] [Дашборд] [Лиды]
- [x] Active state для текущей страницы (data-active)
- [x] Back link на lead detail
- [x] Responsive nav (gap shrink на мобильных)
- [x] `npm run web:check` ✅

---

## Фаза 5: Responsive + A11y

### T11: Responsive pass
- [x] Detail layout: sidebar stack ≤768px
- [x] Page header: stack ≤768px
- [x] Metric grid: 2-col tablet, 1-col mobile
- [x] Filter bar: wrap на мобильных
- [x] Action button groups: wrap
- [x] Проверка breakpoints: 640px, 768px

### T12: Accessibility pass
- [x] skip-link на всех внутренних страницах (в InternalPageFrame)
- [x] `:focus-visible` — полный набор (все interactive)
- [x] aria-label на ScoreGauge (role=meter)
- [x] aria-label на GateBadgeInline
- [x] Table: `<th scope="col">`
- [x] aria-current="page" на активном nav item
- [x] `npm run web:check` ✅

---

## Фаза 6: Polish

### T13: Micro-interactions
- [x] Page fade-in animation (0.25s ease-out)
- [x] ContentCard hover shadow
- [x] MetricCard hover shadow + translateY
- [x] `prefers-reduced-motion` для всех (включая fade-in)

---

## Inline-style inventory (до → после)

| Файл | До | После |
|---|---|---|
| `leads/page.tsx` | 55 | 1 (minWidth) |
| `leads/[id]/page.tsx` | 55 | 3 (maxWidth, layout flex, feedbackNote) |
| `leads/leads-filters.tsx` | ~15 | 0 |
| `leads/[id]/feedback-buttons.tsx` | ~10 | 0 |
| `leads/[id]/outreach-picker.tsx` | ~18 | 0 |
| `dashboard/page.tsx` | 3 | 1 (marginTop flex) |
| `checkout/page.tsx` | 1 | 3 (maxWidth, layout, margin — structural) |
| **Итого** | **~157** | **~8** (all structural/layout) |

---

## Изменённые/созданные файлы

### Новые
- `apps/web/app/ui/internal-page.module.css` — design system для внутренних страниц
- `apps/web/app/ui/internal-page.tsx` — React-компоненты
- `apps/web/app/leads/leads.module.css` — leads page CSS
- `apps/web/app/leads/leads-filters.module.css` — filters CSS
- `apps/web/app/leads/[id]/feedback-buttons.module.css` — feedback CSS
- `apps/web/app/leads/[id]/outreach-picker.module.css` — outreach CSS

### Изменённые
- `apps/web/app/leads/page.tsx` — полная переработка на internal-page
- `apps/web/app/leads/[id]/page.tsx` — полная переработка на internal-page
- `apps/web/app/leads/leads-filters.tsx` — CSS module
- `apps/web/app/leads/[id]/feedback-buttons.tsx` — CSS module + ScoreTone
- `apps/web/app/leads/[id]/outreach-picker.tsx` — CSS module
- `apps/web/app/dashboard/page.tsx` — InternalPageFrame + nav
- `apps/web/app/dashboard/dashboard.module.css` — tokens + focus-visible
- `apps/web/app/checkout/page.tsx` — полная переработка на internal-page
