# План: Исправления и доработки UX Overhaul

**Версия:** 1.0  
**Дата:** 2026-06-12  
**Статус:** На ревью  
**Связано:** ревью коммита `e344169`, `tasks/todo-ux-overhaul.md`

---

## Контекст

Пятиосный ревью выявил 2 Critical, 4 Important, 5 Suggestion. Этот план покрывает все Critical и Important, плюс несколько ценных Suggestion. Задачи нарезаны вертикально — каждая завершает полный путь: код → проверка → коммит.

---

## Зависимости (граф)

```
F1 (dead CSS) ← независима
F2 (double nav) ← независима
F3 (nested <main>) ← независима
F4 (label maps DRY) ← зависит от F1 (удаляем dead CSS вместе с GATE/FEEDBACK лейблами из internal-page)
F5 (alias rename) ← зависит от F4 (переименование затрагивает те же файлы)
F6 (remaining inline styles) ← независима, но лучше после F5 (те же файлы)
F7 (checkout success/cancel) ← независима
F8 (repairPossiblyMojibakeText) ← зависит от F4 (internal-page.tsx)
F9 (animation refinement) ← зависит от F1 (internal-page.module.css)
```

---

## Задачи

### F1: Удалить мёртвый CSS из internal-page.module.css

**Проблема:** ~200 строк дублированных правил (feedbackBtn*, templateTab*, actionBtn*, filterBar*, filterSelect*, filterReset*, errorText) — те же классы определены в локальных CSS-модулях (feedback-buttons.module.css, outreach-picker.module.css, leads-filters.module.css). internal-page версии никогда не используются.

**Вертикальный срез:**
1. Удалить из `internal-page.module.css` блоки:
   - `/* ── Feedback button ── */` (L529–586)
   - `/* ── Template tab (outreach picker) ── */` (L588–667)
   - `/* ── Filter bar ── */` (L483–527)
2. Удалить `errorText` из internal-page.module.css (дублирует feedback-buttons.module.css и outreach-picker.module.css)
3. Обновить `prefers-reduced-motion` блок — убрать `.feedbackBtn, .templateTab, .actionBtn` (уже в локальных модулях)
4. `npm run web:check` ✅
5. `npm run web:build` — проверить что bundle size уменьшился

**Критерий приёмки:** В internal-page.module.css нет классов, которые дублируют локальные CSS-модули. Все страницы рендерятся корректно.

---

### F2: Устранить двойную навигацию на Dashboard

**Проблема:** Dashboard рендерит TopNav (из InternalPageFrame) И DashboardHeader (собственный). Пользователь видит два набора навигации: «Лиды» и «На главную» — дважды.

**Вертикальный срез:**
1. В `dashboard/page.tsx`: убрать `<DashboardHeader />` или заменить на InternalPageHeader
2. Перенести функционал DashboardHeader в InternalPageHeader:
   - Clock (текущее время) → вынести в отдельный клиентский компонент `LiveClock`
   - Sync time → передать как проп InternalPageHeader.subtitle
   - Link «Лиды» → уже в TopNav
   - Link «На главную» → уже в TopNav (← Recruiter Radar)
3. Удалить `dashboard-header.tsx` если все его функции покрыты TopNav + InternalPageHeader
4. `npm run web:check` ✅
5. Визуальная проверка: одна навигация, нет дублей

**Критерий приёмки:** На dashboard одна навигационная панель (TopNav). Часы/статус отображаются в header subtitle. DashboardHeader удалён.

---

### F3: NotFoundState — убрать вложенный `<main>`

**Проблема:** NotFoundState возвращает `<main>`, но может использоваться внутри InternalPageFrame (который уже рендерит `<main>`). Невалидный HTML: `<main>` внутри `<main>`.

**Вертикальный срез:**
1. В `internal-page.tsx`: NotFoundState → заменить `<main>` на `<div>`
2. Проверить что leads/[id]/page.tsx использует NotFoundState **вместо** InternalPageFrame (уже так) — OK
3. Добавить JSDoc: «Use instead of InternalPageFrame, not inside it»
4. `npm run web:check` ✅

**Критерий приёмки:** NotFoundState не рендерит `<main>`. HTML валиден.

---

### F4: Централизовать GATE_LABELS и FEEDBACK_LABELS

**Проблема:** GATE_LABELS определён в 3 файлах, FEEDBACK_LABELS — в 2. DRY нарушение.

**Вертикальный срез:**
1. В `internal-page.tsx`: экспортировать `GATE_LABELS`, `GATE_DESC` (расширенная версия с descriptions), `FEEDBACK_LABELS` (с icons)
2. В `dashboard-quality.tsx`: импортировать `GATE_LABELS` из internal-page
3. В `leads/[id]/page.tsx`: импортировать `GATE_DESC` и `FEEDBACK_LABELS` из internal-page, удалить локальные константы
4. `npm run web:check` ✅

**Критерий приёмки:** GATE_LABELS/GATE_DESC/FEEDBACK_LABELS определены в одном месте. Все потребители импортируют из internal-page.

---

### F5: Переименовать `internalPageClasses as s` → `ipStyles`

**Проблема:** `s` — слишком короткий и неинформативный алиас для CSS-модуля, особенно в файлах с несколькими импортами.

**Вертикальный срез:**
1. В 4 файлах заменить `internalPageClasses as s` → `internalPageClasses as ipStyles`:
   - `leads/page.tsx`
   - `leads/[id]/page.tsx`
   - `checkout/page.tsx`
   - (dashboard/page.tsx не использует `s` напрямую)
2. Заменить все `s.className` → `ipStyles.className`
3. `npm run web:check` ✅

**Критерий приёмки:** Нет `as s` импортов internalPageClasses. Все использования — `ipStyles.*`.

---

### F6: Добить оставшиеся inline styles в leads/[id]/page.tsx

**Проблема:** 3 оставшихся inline style (structural но выносимых):
- L68: `style={{ maxWidth: '960px', margin: '0 auto' }}` — контейнер lead detail
- L99: `style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}` — evidence tags wrap
- L174: `style={{ fontSize: '0.8rem', color: 'var(--c-text-muted)', ... }}` — feedbackNote
- L189: `style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}` — source chips wrap

**Вертикальный срез:**
1. Добавить в `internal-page.module.css`:
   - `.leadDetailContainer` (max-width: 960px, margin: 0 auto)
   - `.chipWrap` (display: flex, gap: 8px, flexWrap: wrap) — reusable
   - `.chipWrapSm` (gap: 6px) — для source chips
   - `.feedbackNote` (fontSize, color, fontStyle, margins)
2. Заменить 4 inline style на CSS-классы
3. `npm run web:check` ✅

**Критерий приёмки:** leads/[id]/page.tsx — 0 inline `style={}` (кроме динамических width в ScoreGauge/ScoreBar).

---

### F7: Checkout success/cancel — обернуть в InternalPageFrame

**Проблема:** `checkout/order/[orderId]/success/page.tsx` и `cancel/page.tsx` используют PageFrame (landing-style) вместо InternalPageFrame. У них 2 inline style каждый. Визуально отличаются от checkout/page.tsx.

**Вертикальный срез:**
1. Заменить `PageFrame` → `InternalPageFrame` с navItems
2. Заменить `SurfaceCard` → `ContentCard` (или оставить SurfaceCard — он из page-primitives, тоже использует токены)
3. Убрать inline style `display: "grid"`, `display: "flex"` → CSS-классы
4. `npm run web:check` ✅

**Критерий приёмки:** Checkout success/cancel визуально консистентны с checkout page. 0 inline styles.

---

### F8: Добавить repairPossiblyMojibakeText в internal-page.tsx

**Проблема:** page-primitives.tsx применяет `repairPossiblyMojibakeText` ко всем видимым строкам. internal-page.tsx — нет. Russian copy из DB может содержать mojibake.

**Вертикальный срез:**
1. Импортировать `repairPossiblyMojibakeText` из `../../lib/copy/repair`
2. Создать `repairVisibleNode` (аналог page-primitives.tsx:147–149)
3. Обернуть все string props в GateBadgeInline, FeedbackBadge, ContentCardTitle, EmptyState, InternalPageTitle
4. `npm run web:check` ✅

**Критерий приёмки:** Все видимые строки в internal-page компонентах проходят через repairPossiblyMojibakeText.

---

### F9: Уточнить page fade-in анимацию

**Проблема:** `animation: pageFadeIn` срабатывает при каждом mount. При client-side navigation Next.js может не unmount/mount — анимация может не сработать или сработать неожиданно.

**Вертикальный срез:**
1. Добавить `will-change: opacity, transform` на `.internalPageFrameInner`
2. Добавить `animation-fill-mode: both` для корректного начального состояния
3. `npm run web:check` ✅

**Критерий приёмки:** Анимация работает предсказуемо при SSR и client navigation.

---

## Порядок выполнения

```
F1 (dead CSS)      ← независимо, сначала
F2 (double nav)    ← независимо
F3 (nested main)   ← независимо
F4 (label maps)    ← после F1
F5 (alias rename)  ← после F4 (те же файлы)
F6 (inline styles) ← после F5 (те же файлы)
F7 (checkout s/c)  ← независимо
F8 (mojibake)      ← после F4 (internal-page.tsx)
F9 (animation)     ← после F1 (internal-page.module.css)
```

---

## Milestones

| Milestone | Задачи | Критерий |
|---|---|---|
| M1: Critical fixes | F1, F2, F3 | 0 dead CSS, 1 nav on dashboard, valid HTML |
| M2: DRY + readability | F4, F5 | Single source of truth для labels, понятные алиасы |
| M3: Inline cleanup | F6, F7 | 0 inline styles на leads/detail + checkout s/c |
| M4: Polish | F8, F9 | Mojibake repair + animation refinement |

---

## Риски

| Риск | Митигация |
|---|---|
| F2: DashboardHeader содержит LiveClock (client component) — нужен отдельный компонент | Вынести в `dashboard/live-clock.tsx` |
| F7: Checkout success/cancel используют SurfaceCard из page-primitives — с другим визуальным стилем | Оставить SurfaceCard (он уже использует токены) или мигрировать |
| F4: dashboard-quality.tsx — client component, импорт из internal-page (server component) — OK, типы доступны | Проверить что типы exportятся корректно |

---

## Scope exclusions

- Dashboard sub-components inline styles (overview, quality, sources, alerts) — все динамические (progress widths, skeleton sizes)
- `page.tsx` (landing) — не затрагивается
- Onboarding pages — используют page-primitives, не internal-page
