# TODO — UX Fixes (post-review)

**Связано:** `tasks/plan-ux-fixes.md` (полный план)  
**Обновлено:** 2026-06-12  
**Источник:** Пятиосный ревью коммита `e344169`

---

## M1: Critical fixes

### F1: Удалить мёртвый CSS из internal-page.module.css
- [ ] Удалить блоки Feedback button, Template tab, Filter bar, errorText
- [ ] Обновить prefers-reduced-motion — убрать .feedbackBtn, .templateTab, .actionBtn
- [ ] `npm run web:check` ✅
- [ ] `npm run web:build` — bundle size check

### F2: Устранить двойную навигацию на Dashboard
- [ ] Вынести LiveClock в `dashboard/live-clock.tsx`
- [ ] Заменить DashboardHeader на InternalPageHeader + LiveClock
- [ ] Удалить `dashboard/dashboard-header.tsx`
- [ ] `npm run web:check` ✅

### F3: NotFoundState — убрать вложенный `<main>`
- [ ] Заменить `<main>` на `<div>` в NotFoundState
- [ ] Добавить JSDoc: use instead of InternalPageFrame
- [ ] `npm run web:check` ✅

---

## M2: DRY + readability

### F4: Централизовать GATE_LABELS и FEEDBACK_LABELS
- [ ] Экспортировать GATE_LABELS, GATE_DESC, FEEDBACK_LABELS из internal-page.tsx
- [ ] dashboard-quality.tsx → импортировать GATE_LABELS из internal-page
- [ ] leads/[id]/page.tsx → импортировать GATE_DESC, FEEDBACK_LABELS из internal-page
- [ ] Удалить локальные константы
- [ ] `npm run web:check` ✅

### F5: Переименовать `internalPageClasses as s` → `ipStyles`
- [ ] leads/page.tsx: `as s` → `as ipStyles`, все `s.*` → `ipStyles.*`
- [ ] leads/[id]/page.tsx: то же
- [ ] checkout/page.tsx: то же
- [ ] `npm run web:check` ✅

---

## M3: Inline cleanup

### F6: Добить inline styles в leads/[id]/page.tsx
- [ ] Добавить .leadDetailContainer, .chipWrap, .chipWrapSm, .feedbackNote в internal-page.module.css
- [ ] Заменить 4 inline style на CSS-классы
- [ ] `npm run web:check` ✅

### F7: Checkout success/cancel — InternalPageFrame
- [ ] Заменить PageFrame → InternalPageFrame с navItems
- [ ] Убрать inline styles → CSS-классы
- [ ] `npm run web:check` ✅

---

## M4: Polish

### F8: repairPossiblyMojibakeText в internal-page.tsx
- [ ] Импортировать repairPossiblyMojibakeText
- [ ] Создать repairVisibleNode helper
- [ ] Обернуть string props в GateBadgeInline, FeedbackBadge, ContentCardTitle, EmptyState, InternalPageTitle
- [ ] `npm run web:check` ✅

### F9: Уточнить page fade-in анимацию
- [ ] Добавить will-change: opacity, transform
- [ ] Добавить animation-fill-mode: both
- [ ] `npm run web:check` ✅
