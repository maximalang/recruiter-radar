# План доработки UX — Recruiter Radar

**Версия:** 1.0  
**Дата:** 2026-06-12  
**Статус:** На ревью  
**Совместный workflow:** вертикальные срезы, каждый завершает полный путь от токена → компонент → страница → проверка

---

## Контекст и аудит

### Что уже хорошо ✅
- Landing (`/`) — премиальный стиль, CSS модули с design tokens, hover/focus/reduced-motion
- Onboarding (`/onboarding/pilot/[orderId]`) — использует page-primitives, визуально близок к лендингу
- `page-primitives.module.css` — единые токены (цвета, радиусы, типографика, gate-бейджи)
- Inter шрифт подключён через `next/font/google`

### Критические проблемы ❌

| # | Проблема | Где | Влияние |
|---|---|---|---|
| P1 | **3 визуальных языка** — landing (premium 24px), dashboard (admin 0.5rem), leads (inline-only) | `dashboard/`, `leads/` | Пользователь видит 3 разных продукта |
| P2 | **55+ inline style** в leads — ноль CSS модулей | `leads/page.tsx`, `leads/[id]/page.tsx` | Невозможно поддерживать, нет адаптивности |
| P3 | **Нет responsive** на внутренних страницах | dashboard, leads, checkout | Мобильный доступ сломан |
| P4 | **Checkout — заглушка** — кнопка и параграф | `checkout/page.tsx` | Конверсия обрывается |
| P5 | **Нет навигации** между внутренними страницами | dashboard ↔ leads ↔ onboarding | Пользователь теряется |
| P6 | **Accessibility дыры** — нет skip-link, нет focus-visible на кнопках | leads filters, feedback, outreach picker | WCAG AA fail |

### Карта inline-style долга

| Страница | inline `style={}` | CSS модуль |
|---|---|---|
| `leads/page.tsx` | **55** | ❌ нет |
| `leads/[id]/page.tsx` | **55** | ❌ нет |
| `leads/leads-filters.tsx` | **~15** | ❌ нет |
| `leads/[id]/feedback-buttons.tsx` | **~10** | ❌ нет |
| `leads/[id]/outreach-picker.tsx` | **~18** | ❌ нет |
| `dashboard/page.tsx` | 3 | ✅ `dashboard.module.css` |
| `checkout/page.tsx` | 1 | ❌ нет |
| `page.tsx` (landing) | ~8 | ✅ |

---

## Зависимости между задачами

```
T1 (internal primitives) ──► T2 (leads CSS module) ──► T3 (leads pages)
                              │                          │
                              │                          ├─► T6 (feedback buttons)
                              │                          ├─► T7 (outreach picker)
                              │                          └─► T8 (leads filters)
                              │
                              ├─► T4 (dashboard alignment)
                              └─► T5 (checkout redesign)

T3 + T4 + T5 ──► T9 (shared nav + page shell)
T9 ──► T10 (responsive pass)
T10 ──► T11 (accessibility pass)
T11 ──► T12 (interaction polish)
```

---

## Фаза 1: Foundation — внутренние primitives + CSS модули

> Цель: создать реusable CSS-основа для всех внутренних страниц, чтобы leads/dashboard/checkout говорили на одном визуальном языке с лендингом.

### T1: internal-page.module.css — токены и компоненты для внутренних страниц

**Проблема:** Внутренние страницы не имеют доступа к лендинговым токенам и компонентам (SurfaceCard, StatusBadge и т.д. живут в `page-primitives`, но стили не покрывают таблицы, метрики, формы внутренних страниц).

**Решение:** Создать `apps/web/app/ui/internal-page.module.css` + `internal-page.tsx` с наборами компонентов для внутренних страниц, переиспользуя токены из `:root` (уже определены в `page-primitives.module.css`).

**Файлы:**
- `apps/web/app/ui/internal-page.module.css` — новый
- `apps/web/app/ui/internal-page.tsx` — новый

**Компоненты:**

```css
/* internal-page.module.css — использует те же :root токены */

/* Page shell */
.internalPageFrame { ... } /* с навигацией, max-width, bg */

/* Metric card */
.metricCard { ... }

/* Data table */
.dataTable { ... }
.dataTableHead { ... }
.dataTableRow { ... }
.dataTableCell { ... }

/* Sidebar layout */
.detailLayout { ... }
.detailMain { ... }
.detailSidebar { ... }

/* Gate badge — reuse .gateBadge tokens */
.gateBadgeInline { ... }

/* Score gauge */
.scoreGauge { ... }
.scoreGaugeCircle { ... }
.scoreGaugeBar { ... }

/* Feedback button */
.feedbackBtn { ... }
.feedbackBtn[data-active="true"] { ... }
.feedbackBtn[data-tone="success"] { ... }

/* Filter bar */
.filterBar { ... }
.filterSelect { ... }
.filterReset { ... }
```

**TSX компоненты:**
- `InternalPageFrame` — shell с breadcrumb/nav
- `MetricCard` — карточка метрики (label + value + subtext)
- `DataTable` / `DataRow` — таблица лидов
- `DetailLayout` — 2-колоночный layout с responsive collapse
- `GateBadgeInline` — gate badge (inline-версия, те же цвета)
- `ScoreGauge` — визуальный скоринг
- `FeedbackButton` — кнопка обратной связи
- `FilterSelect` — стилизованный select

**Критерии приёмки:**
- [ ] Все компоненты используют `var(--c-*)`, `var(--fs-*)`, `var(--radius-*)` токены
- [ ] Border-radius совпадает с landing: card=24px, inner=18px, pill=999px
- [ ] Цвета карточек/текста идентичны landing
- [ ] Компоненты имеют `:focus-visible` стили
- [ ] `prefers-reduced-motion` для анимированных

**Верификация:** `npm run web:check` + ручной просмотр компонент в storybook/странице

---

### T2: leads.module.css — стили для leads-страниц

**Проблема:** `leads/page.tsx` — 55 inline styles, ноль CSS модулей.

**Решение:** Создать `apps/web/app/leads/leads.module.css`, перенести все inline-стили в CSS-классы с использованием токенов.

**Файлы:**
- `apps/web/app/leads/leads.module.css` — новый

**Классы (извлекаются из inline styles):**

```css
/* Page layout */
.leadsPage { ... }
.leadsHeader { ... }
.leadsHeaderTitle { ... }
.leadsSummaryGrid { ... }

/* Table */
.leadsTableWrapper { ... }
.leadsTable { ... }
.leadsTableHead { ... }
.leadsTableHeader { ... }
.leadsTableBody { ... }

/* Lead row */
.leadRow { ... }
.leadCell { ... }
.leadOrgLink { ... }
.leadOrgName { ... }
.leadLocation { ... }
.leadEvidence { ... }
.leadDate { ... }

/* Empty state */
.leadsEmpty { ... }
```

**Критерии приёмки:**
- [ ] 0 inline `style={}` в `leads/page.tsx` (кроме динамических `width` для ScoreBar)
- [ ] Все классы используют design tokens
- [ ] Визуальный результат идентичен текущему (pixel-aware)

**Верификация:** `npm run web:check` + скриншот-сравнение до/после

---

## Фаза 2: Leads — полный редизайн

> Цель: Leads перестаёт быть прототипом и становится частью продукта.

### T3: leads/page.tsx — рефакторинг на CSS модули

**Зависимость:** T1 + T2

**Файлы:**
- `apps/web/app/leads/page.tsx` — модификация
- `apps/web/app/leads/leads.module.css` — модификация

**Шаги:**
1. Заменить все inline styles на CSS-классы из `leads.module.css`
2. Заменить `GateBadge`, `FeedbackBadge`, `ScoreBar` на компоненты из `internal-page.tsx`
3. Заменить `LeadsTable` HTML на `DataTable` из primitives
4. Summary cards → `MetricCard` компоненты
5. Header → `InternalPageFrame` с навигацией

**Критерии приёмки:**
- [ ] 0 inline `style={}` (кроме динамических значений)
- [ ] Визуально идентично текущему на desktop
- [ ] Появляется базовый responsive (table → card на мобильных)
- [ ] `npm run web:check` проходит

**Верификация:** `npm run web:check` + ручная проверка `/leads`

---

### T4: dashboard — визуальное выравнивание на landing design system

**Зависимость:** T1

**Проблема:** Dashboard использует свою систему: `0.5rem` radius, `#e5e7eb` borders, flat white cards — corporate/admin стиль, не premium. При этом 860+ строк CSS в `dashboard.module.css` уже написаны.

**Решение:** Постепенная миграция — обновить ключевые визуальные параметры в `dashboard.module.css` на landing-токены, не переписывая с нуля.

**Файлы:**
- `apps/web/app/dashboard/dashboard.module.css` — модификация
- `apps/web/app/dashboard/page.tsx` — модификация (убрать 3 inline styles)
- `apps/web/app/dashboard/dashboard-*.tsx` — модификация (по мере необходимости)

**Шаги:**
1. Обновить border-radius: `0.5rem` → `var(--radius-card-sm, 18px)` для вложенных, `var(--radius-card, 24px)` для основных карточек
2. Обновить border color: `#e5e7eb` → `var(--c-border)`
3. Обновить card background: `white` → `var(--c-bg-card)`
4. Обновить page background: `#f9fafb` → `var(--c-bg-page)`
5. Обновить shadow: текущие → landing shadow tokens
6. Убрать 3 inline styles из `page.tsx`
7. Header: заменить inline на `InternalPageFrame`

**Критерии приёмки:**
- [ ] Dashboard визуально близок к landing (тот же язык, но более плотный layout)
- [ ] 0 inline styles в `dashboard/page.tsx`
- [ ] Responsive breakpoints работают (уже есть в `dashboard.module.css`)
- [ ] `npm run web:check` проходит

**Верификация:** `npm run web:check` + скриншот-сравнение `/dashboard`

---

### T5: checkout/page.tsx — редизайн

**Зависимость:** T1

**Проблема:** Checkout — заглушка: голый `<h1>Checkout</h1>`, кнопка и параграф. Никакой визуальной связи с лендингом. Пользователь теряет доверие.

**Решение:** Полный редизайн checkout на основе page-primitives.

**Файлы:**
- `apps/web/app/checkout/page.tsx` — модификация
- `apps/web/app/checkout/checkout.module.css` — новый (если нужно)

**Шаги:**
1. Обернуть в `InternalPageFrame`
2. Показать сводку заказа: тариф, цена, параметры из preview
3. SurfaceCard с описанием что пользователь покупает
4. Структурированная кнопка оплаты (не голая `<button>`)
5. Назад на главную
6. Страховочный текст: «Оплата запускается только после подтверждения»

**Критерии приёмки:**
- [ ] Checkout выглядит как часть продукта, а не prototype
- [ ] Показывает что покупает пользователь (тариф, параметры)
- [ ] Есть clear CTA и back-link
- [ ] Responsive
- [ ] `npm run web:check` проходит

**Верификация:** `npm run web:check` + ручная проверка `/checkout`

---

## Фаза 3: Leads detail — клиентские компоненты

### T6: feedback-buttons — рефакторинг на CSS модуль

**Зависимость:** T1

**Проблема:** `FeedbackButtons` — 10 inline styles, нет focus-visible, нет disabled styling через CSS.

**Решение:** Создать `apps/web/app/leads/[id]/feedback-buttons.module.css` и перенести стили.

**Файлы:**
- `apps/web/app/leads/[id]/feedback-buttons.tsx` — модификация
- `apps/web/app/leads/[id]/feedback-buttons.module.css` — новый

**Шаги:**
1. Создать CSS модуль с `.feedbackBtn`, `.feedbackBtn[data-active]`, `.feedbackBtn[data-tone="success"]` и т.д.
2. Заменить inline styles на CSS-классы + data-атрибуты
3. Добавить `:focus-visible` стиль
4. Добавить `:disabled` через CSS
5. Error message → отдельный класс

**Критерии приёмки:**
- [ ] 0 inline styles
- [ ] `:focus-visible` работает
- [ ] `:disabled` через CSS, не через inline opacity
- [ ] Визуально идентично текущему

**Верификация:** `npm run web:check` + ручная проверка feedback buttons

---

### T7: outreach-picker — рефакторинг на CSS модуль

**Зависимость:** T1

**Проблема:** `OutreachPicker` — 18 inline styles, нет focus-visible, нет loading state через CSS.

**Решение:** Создать `apps/web/app/leads/[id]/outreach-picker.module.css`.

**Файлы:**
- `apps/web/app/leads/[id]/outreach-picker.tsx` — модификация
- `apps/web/app/leads/[id]/outreach-picker.module.css` — новый

**Шаги:**
1. CSS модуль с классами: `.templateTab`, `.templateTab[data-selected]`, `.renderedTemplate`, `.actionBtn`, `.actionBtn[data-state]`
2. Заменить inline styles
3. Добавить `:focus-visible`
4. Copied/sent states через data-атрибуты + CSS

**Критерии приёмки:**
- [ ] 0 inline styles
- [ ] `:focus-visible` работает
- [ ] Copied/Sent/Error состояния через CSS data-attributes
- [ ] Визуально идентично текущему

**Верификация:** `npm run web:check` + ручная проверка outreach picker

---

### T8: leads-filters — рефакторинг на CSS модуль

**Зависимость:** T1

**Проблема:** `LeadsFilters` — ~15 inline styles, select стилизован inline.

**Решение:** Создать `apps/web/app/leads/leads-filters.module.css` или использовать `FilterSelect` из internal primitives.

**Файлы:**
- `apps/web/app/leads/leads-filters.tsx` — модификация
- `apps/web/app/leads/leads-filters.module.css` — новый

**Критерии приёмки:**
- [ ] 0 inline styles
- [ ] Select стилизован через CSS
- [ ] `:focus-visible` на select и кнопке сброса
- [ ] Визуально идентично текущему

**Верификация:** `npm run web:check`

---

### T9: leads/[id]/page.tsx — рефакторинг на CSS модули + detail layout

**Зависимость:** T1 + T6 + T7

**Проблема:** Lead detail — 55 inline styles, sidebar layout `1fr 300px` ломается на мобильных.

**Решение:** Рефакторинг с использованием `DetailLayout` из internal primitives.

**Файлы:**
- `apps/web/app/leads/[id]/page.tsx` — модификация
- `apps/web/app/leads/[id]/lead-detail.module.css` — новый

**Шаги:**
1. Создать CSS модуль с классами для всех секций
2. Заменить inline styles на CSS-классы
3. Использовать `GateBadgeInline` вместо inline gate config
4. Использовать `ScoreGauge` вместо inline
5. Responsive: sidebar → stacked на мобильных (`@media max-width: 768px`)
6. Секция «Факторы риска» → `NoticeBox` с tone="danger"

**Критерии приёмки:**
- [ ] 0 inline styles (кроме динамических значений)
- [ ] Responsive: sidebar collapse на ≤768px
- [ ] Все секции используют page-primitives или internal-page компоненты
- [ ] Визуально идентично на desktop
- [ ] `npm run web:check` проходит

**Верификация:** `npm run web:check` + проверка `/leads/[id]` на desktop и мобильном

---

## Фаза 4: Навигация и page shell

### T10: InternalPageFrame + shared navigation

**Зависимость:** T3 + T4 + T5

**Проблема:** Нет единой навигации между внутренними страницами. Каждая страница строит свой header. Пользователь не может перейти из dashboard в leads или обратно на главную единообразно.

**Решение:** Расширить `InternalPageFrame` из T1, добавить навигацию.

**Файлы:**
- `apps/web/app/ui/internal-page.tsx` — модификация
- `apps/web/app/ui/internal-page.module.css` — модификация

**Навигация:**
```
[← Recruiter Radar]  [Дашборд] [Лиды] [Настройки]
```

**Шаги:**
1. Добавить top nav bar в `InternalPageFrame`
2. Active state для текущей страницы
3. Breadcrumb для вложенных (Lead detail ← Лиды)
4. Responsive: hamburger или collapse на мобильных

**Критерии приёмки:**
- [ ] Единая навигация на dashboard, leads, lead detail
- [ ] Active state виден
- [ ] Breadcrumb на lead detail
- [ ] Responsive nav на мобильных
- [ ] `npm run web:check` проходит

**Верификация:** `npm run web:check` + ручная проверка навигации на всех страницах

---

## Фаза 5: Responsive и Accessibility

### T11: Responsive pass — все внутренние страницы

**Зависимость:** T10

**Проблема:** Dashboard имеет responsive, но leads и checkout — нет. Lead detail ломается на мобильных.

**Шаги:**

1. **leads/page.tsx** — table → card layout на ≤768px
2. **leads/[id]/page.tsx** — sidebar stack на ≤768px
3. **dashboard/page.tsx** — уже есть responsive, проверить edge cases
4. **checkout/page.tsx** — responsive padding/max-width
5. **Shared breakpoints** через CSS custom properties:
   ```css
   --bp-tablet: 1024px;
   --bp-mobile: 640px;
   --bp-narrow: 768px; /* для detail layouts */
   ```

**Критерии приёмки:**
- [ ] Все 4 внутренние страницы корректно отображаются на 375px, 768px, 1024px, 1280px
- [ ] Table не горизонтально скроллится на мобильных (→ card layout)
- [ ] Detail sidebar stack'ается
- [ ] `npm run web:check` проходит

**Верификация:** Ручная проверка Chrome DevTools device mode на всех брейкпоинтах

---

### T12: Accessibility pass

**Зависимость:** T11

**Шаги:**

1. **skip-link** на dashboard, leads, checkout, lead detail
2. **focus-visible** — проверить что все interactive элементы имеют видимый focus
3. **aria-label** на ScoreGauge, GateBadge, FeedbackButtons
4. **Table accessibility** — `<th scope="col">`, `aria-sort` для сортируемых
5. **Form error states** — `aria-invalid`, `aria-describedby` для onboarding формы (уже есть `label htmlFor` ✅)
6. **Color contrast** — проверить все text/background пары на WCAG AA
7. **Keyboard navigation** — Tab order через все страницы, focus trap в модалах (если появятся)

**Критерии приёмки:**
- [ ] skip-link на каждой внутренней странице
- [ ] Все кнопки/links/selects имеют `:focus-visible`
- [ ] Table headers имеют `scope="col"`
- [ ] Цветовой контраст ≥ 4.5:1 для body text
- [ ] Tab navigation работает логично
- [ ] `npm run web:check` проходит

**Верификация:** axe-core browser extension scan на каждой странице

---

## Фаза 6: Interaction polish

### T13: Micro-interactions и visual polish

**Зависимость:** T12

**Шаги:**

1. **ScoreGauge** — SVG circle с animated fill вместо CSS border hack
2. **Feedback buttons** — press animation (scale 0.96)
3. **Lead row hover** — subtle highlight (как SurfaceCard hover)
4. **Page transitions** — fade-in при навигации (CSS only)
5. **Loading skeletons** — унифицировать с dashboard skeletons
6. **Checkout** — loading state на кнопке оплаты (через FormSubmitButton)

**Критерии приёмки:**
- [ ] ScoreGauge — SVG с animated stroke-dashoffset
- [ ] Feedback buttons имеют press animation
- [ ] Lead rows имеют hover highlight
- [ ] Loading states единообразны
- [ ] `prefers-reduced-motion` отключает все анимации
- [ ] `npm run web:check` проходит

**Верификация:** `npm run web:check` + ручная проверка interactions

---

## Порядок выполнения

```
Фаза 1 (2–3 дня):
  T1: internal primitives ───► T2: leads CSS module

Фаза 2 (3–4 дня):
  T3: leads page refactor ───► T4: dashboard alignment ───► T5: checkout redesign
  (T4 и T5 параллельно после T1)

Фаза 3 (2–3 дня):
  T6: feedback buttons ───► T7: outreach picker ───► T8: leads filters ───► T9: lead detail
  (T6, T7, T8 параллельно после T1)

Фаза 4 (1–2 дня):
  T10: shared nav + page shell

Фаза 5 (2 дня):
  T11: responsive ───► T12: accessibility

Фаза 6 (1 день):
  T13: interaction polish
```

**Итого:** ~11–14 рабочих дней

---

## Milestones

| Milestone | Критерий | Срок |
|---|---|---|
| M1: Foundation | T1+T2 выполнены, CSS модули готовы | +3 дня |
| M2: Visual unity | T3+T4+T5 выполнены, все страницы в едином стиле | +7 дней |
| M3: Component quality | T6+T7+T8+T9 выполнены, 0 inline styles в leads | +10 дней |
| M4: Navigation | T10 выполнен, единая навигация | +12 дней |
| M5: Production-ready UX | T11+T12+T13 выполнены, responsive + a11y + polish | +14 дней |

---

## Чекпоинты

### Чекпоинт 1 (после M1)
- [ ] `internal-page.module.css` существует и содержит все базовые компоненты
- [ ] `leads.module.css` существует
- [ ] `npm run web:check` проходит
- **Риск:** Если токены из page-primitives не подходят для внутренних страниц — пересмотреть

### Чекпоинт 2 (после M2)
- [ ] Все 4 основные страницы (landing, dashboard, leads, checkout) визуально едины
- [ ] 0 inline styles в leads/page.tsx
- [ ] Скриншот-сравнение показывает только ожидаемые изменения
- **Риск:** Dashboard migration может сломать responsive — тестировать на мобильных

### Чекпоинт 3 (после M3)
- [ ] 0 inline styles во всех leads/* компонентах
- [ ] Feedback buttons, outreach picker, filters — CSS модули
- [ ] Lead detail responsive
- **Риск:** Client components могут требовать `'use client'` + CSS modules — проверить совместимость

### Чекпоинт 4 (после M5)
- [ ] axe-core scan: 0 critical/serious findings
- [ ] Responsive на 375px, 768px, 1024px, 1280px
- [ ] `npm run web:check` + `npm run web:build` проходят

---

## Риски и смягчение

| Риск | Вероятность | Влияние | Смягчение |
|---|---|---|---|
| CSS modules + `'use client'` конфликты | Средняя | Среднее | Проверить на T6 (первый client component) |
| Dashboard migration ломает responsive | Средняя | Высокое | Тестировать на мобильных после каждого шага |
| Визуальная регрессия при inline→CSS переносе | Высокая | Среднее | Pixel-aware подход: сначала 1:1 перенос, потом улучшения |
| Scope creep — фичи сверх плана | Высокая | Среднее | Строго: только перенос стилей и выравнивание, новый функционал — отдельно |
| `page-primitives.module.css` :root не доступен из других CSS modules | Низкая | Критическое | :root переменные глобальны в Next.js CSS modules — проверить |

---

## Что НЕ входит в этот план

- Новые страницы (review queue — задача 3 из todo.md)
- Новые поля в LeadItem (why_now, best_angle — задача 2 из todo.md)
- Бэкенд-изменения (scoring, confidence gates)
- Pricing update (задача 1 из todo.md)
- Telegram digest UX (bot-side)
- Performance optimization (code splitting, lazy loading)
