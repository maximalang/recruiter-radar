# TODO — UX Fixes (post-review)

**Связано:** `tasks/plan-ux-fixes.md` (полный план)  
**Обновлено:** 2026-06-12  
**Источник:** Пятиосный ревью коммита `e344169`  
**Коммит:** `851a4d3`

---

## M1: Critical fixes

### F1: Удалить мёртвый CSS из internal-page.module.css
- [x] Удалить блоки Feedback button, Template tab, Filter bar, errorText
- [x] Обновить prefers-reduced-motion — убрать .feedbackBtn, .templateTab, .actionBtn
- [x] Перенести responsive правила filterBar/actionBtnGroup в локальные модули
- [x] `npm run web:check` ✅

### F2: Устранить двойную навигацию на Dashboard
- [x] Вынести LiveClock в `dashboard/live-clock.tsx`
- [x] Заменить DashboardHeader на InternalPageHeader + LiveClock
- [x] Удалить `dashboard/dashboard-header.tsx`
- [x] `npm run web:check` ✅

### F3: NotFoundState — убрать вложенный `<main>`
- [x] Заменить `<main>` на `<div>` в NotFoundState
- [x] Добавить JSDoc: use instead of InternalPageFrame
- [x] Обернуть NotFoundState в `<main>` на call site (leads/[id])
- [x] `npm run web:check` ✅

---

## M2: DRY + readability

### F4: Централизовать GATE_LABELS и FEEDBACK_LABELS
- [x] Экспортировать GATE_LABELS, GATE_DESC, FEEDBACK_LABELS из internal-page.tsx
- [x] dashboard-quality.tsx → импортировать GATE_LABELS из internal-page
- [x] leads/[id]/page.tsx → импортировать GATE_DESC, FEEDBACK_LABELS из internal-page
- [x] Удалить локальные константы
- [x] `npm run web:check` ✅

### F5: Переименовать `internalPageClasses as s` → `ipStyles`
- [x] leads/page.tsx: `as s` → `as ipStyles`, все использования
- [x] leads/[id]/page.tsx: то же
- [x] checkout/page.tsx: то же
- [x] `npm run web:check` ✅

---

## M3: Inline cleanup

### F6: Добить inline styles в leads/[id]/page.tsx
- [x] Добавить .leadDetailContainer, .chipWrap, .chipWrapSm, .feedbackNote в internal-page.module.css
- [x] Заменить 4 inline style на CSS-классы
- [x] `npm run web:check` ✅

### F7: Checkout success/cancel — inline style cleanup
- [x] Заменить inline `display: flex` → ipStyles.chipWrap
- [x] `npm run web:check` ✅

---

## M4: Polish

### F8: repairPossiblyMojibakeText в internal-page.tsx
- [x] Импортировать repairPossiblyMojibakeText
- [x] Создать repairVisibleNode helper
- [x] Обернуть string props в GateBadgeInline, FeedbackBadge, ContentCardTitle, EmptyState, InternalPageTitle
- [x] `npm run web:check` ✅

### F9: Уточнить page fade-in анимацию
- [x] Добавить will-change: opacity, transform
- [x] Добавить animation-fill-mode: both
- [x] `npm run web:check` ✅
