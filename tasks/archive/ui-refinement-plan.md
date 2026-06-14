# UI Refinement Plan

## Scope: Landing page (`/`) and shared primitives (`page-primitives.*`)

Based on code-level audit against modern web standards — typography system, responsive design, accessibility, visual consistency, and interaction design.

---

## 1. Typography System — Foundation

### 1.1 Load Inter font
Добавить `@next/font` для Inter (400, 500, 600, 700, 800). Inter указан в CSS, но никогда не загружен.

**Files:** `layout.tsx`, `page-primitives.module.css`

### 1.2 Establish type scale
Определить CSS‑переменные для типографической шкалы (4 шага):

```css
--fs-xs: 0.75rem;   /* 12px — labels, badges */
--fs-sm: 0.8125rem; /* 13px — secondary text */
--fs-base: 0.9375rem; /* 15px — body */
--fs-lg: 1.125rem;  /* 18px */
--fs-xl: 1.5rem;    /* 24px — section titles */
--fs-2xl: 2.5rem;   /* 40px — hero (clamp down to 2rem) */
--fs-3xl: clamp(2.5rem, 6vw, 4.5rem); /* hero display */
```

Убрать разрозненные `0.72rem`, `0.9rem`, `1.08rem`, и т.д. — заменить на переменные.

### 1.3 Fix heroTitle line-height
`line-height: 0.9` → `line-height: 0.95` для предотвращения clipping верхних выносных.

---

## 2. Design Tokens (CSS Custom Properties)

### 2.1 Define color palette as variables
```css
:root {
  --c-text-primary: #0f172a;
  --c-text-secondary: #475569;
  --c-text-muted: #667085;
  --c-bg-page: #f8fbff;
  --c-bg-card: rgba(255, 255, 255, 0.94);
  --c-border: rgba(15, 23, 42, 0.08);
  --c-brand: #1d4ed8;
  --c-accent: #1e40af;
}
```

### 2.2 Define spacing and radius as variables
```css
  --radius-card: 24px;
  --radius-card-sm: 18px;
  --radius-pill: 999px;
  --space-section: 18px;
  --space-card-padding: 24px;
  --space-card-padding-lg: 32px;
}
```

**Files:** `globals.css` (создать), `page-primitives.module.css`

---

## 3. Responsive Design

### 3.1 Add `@media` breakpoints for key sections
```css
/* Tablet: ≤1024px */
@media (max-width: 1024px) { ... }
/* Mobile: ≤640px */
@media (max-width: 640px) { ... }
```

### 3.2 HeroGrid mobile layout
На мобильных:
- `heroGrid` — отступы `34px` → `20px`
- `heroTitle` — `max-width: 11ch` снять (мало места)
- Кнопки CTA — `flex-direction: column` (stack)
- Signal card — скрыть `surfaceCardDark` на самых узких, оставить только основной

### 3.3 Section padding adaptation
```css
.pageFrame {
  padding: 32px 20px 72px;
}
@media (max-width: 640px) {
  .pageFrame { padding: 20px 14px 48px; }
}
```

---

## 4. Interaction Design

### 4.1 Add transitions
```css
.surfaceCard {
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.surfaceCard:hover {
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.12);
  transform: translateY(-2px);
}
```

Аналогично для кнопок (`primaryAction`, `secondaryAction`):
```css
.primaryAction {
  transition: box-shadow 0.2s ease, transform 0.15s ease;
}
.primaryAction:hover {
  box-shadow: 0 18px 40px rgba(30, 64, 175, 0.32);
  transform: translateY(-1px);
}
.primaryAction:active {
  transform: translateY(0);
}
```

### 4.2 Add focus-visible styles
Для всех кнопок, ссылок, инпутов:
```css
.primaryAction:focus-visible,
.secondaryAction:focus-visible {
  outline: 2px solid var(--c-brand);
  outline-offset: 2px;
}
```

### 4.3 Add `prefers-reduced-motion`
```css
@media (prefers-reduced-motion: reduce) {
  .surfaceCard,
  .primaryAction {
    transition: none;
  }
}
```

---

## 5. Accessibility

### 5.1 Fix `<label>` association
В форме параметров профиля заменить `<span className={ppStyles.fieldLabel}>` на `<label>` с `htmlFor`/`id`.

### 5.2 Add skip-to-content
```html
<a href="#main-content" className="skip-link">Перейти к содержанию</a>
```

### 5.3 Form error states
Добавить `aria-invalid`, `aria-describedby` для инпутов, `role="alert"` для сообщений об ошибках.

---

## 6. Visual Polish

### 6.1 Unify card padding
Выбрать единый padding для SurfaceCard: **24px** (среднее между текущими 20-34px).
- `surfaceCardGradient`: 34px → 32px (чуть больше для hero)
- `surfaceCardDark`: 26px → 24px
- `previewCardContainer`: 24px → остаётся

### 6.2 Unify border-radius
- SurfaceCard: **24px** — остаётся
- previewCard: 22px → 24px (совпадает с SurfaceCard)
- signalRow, mutedPanel, FAQ: 18px — остаётся (вложенные)
- Buttons: 14px → 12px (чуть аккуратнее)

### 6.3 Dark card contrast
Текст на тёмном фоне: `#cbd5e1` → `#e2e8f0` (чуть светлее для читаемости).

### 6.4 Gate badge pill style
В `PreviewDigestCard` gate badge использует inline‑стили — вынести в CSS Module класс:

```css
.gateBadge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
}
.gateBadge[data-gate="A"] { background: #d1fae5; color: #065f46; }
.gateBadge[data-gate="B"] { background: #dbeafe; color: #1e40af; }
.gateBadge[data-gate="C"] { background: #fef3c7; color: #92400e; }
.gateBadge[data-gate="D"] { background: #f3f4f6; color: #4b5563; }
```

### 6.5 Hero stats — add icons or visual separation
Три `mutedPanel` блока со статистикой выглядят плоско. Добавить иконки или divider между ними.

### 6.6 Pricing card hierarchy
Выделить primary-план сильнее: увеличить border-width или добавить `data-featured` бейдж "Рекомендуем".

---

## 7. CSS Refactoring (optional, tech debt)

### 7.1 Migrate inline styles → CSS modules
30+ inline `style={}` в page.tsx можно вынести в CSS классы:
- `GATE_CONFIG` bg/color → data-attribute классы
- `ScoreGauge` — полностью CSS
- PreviewDigestCard gate badge → CSS module

### 7.2 Consolidate card variants
`featureSurfaceCard` и `featureSurfaceCardAlt` отличаются только `background-color` — объединить.

---

## Priority Matrix

| # | Task | Effort | Impact | Quick Win? |
|---|---|---|---|---|
| 1.1 | Load Inter font | 15 min | High | Yes |
| 2 | CSS variables | 30 min | Medium | Yes |
| 4.1 | Transitions on cards/buttons | 20 min | High | Yes |
| 4.2 | Focus-visible styles | 10 min | Medium | Yes |
| 3 | @media breakpoints | 45 min | High | No |
| 6.4 | Gate badge → CSS module | 10 min | Low | Yes |
| 6.1 | Unify card padding | 15 min | Medium | Yes |
| 5.1 | Fix label association | 10 min | Low | Yes |
| 6.6 | Pricing card emphasis | 15 min | Low | Yes |
| 7.1 | Inline → CSS modules | 60 min | Medium | No |

---

## Implementation Order (Recommended)

**Phase 1 — Quick wins (30 min):**
1. Load Inter via `@next/font`
2. Add `transition` and `:hover` effects
3. Add `:focus-visible` styles
4. Gate badge → CSS module
5. Fix `<label>` association

**Phase 2 — Foundation (45 min):**
6. Define CSS custom properties
7. Unify spacing/radius values
8. Fix dark card text contrast

**Phase 3 — Responsive (45 min):**
9. Add `@media` breakpoints
10. Mobile layout adjustments

**Phase 4 — Polish (60 min):**
11. Migrate inline styles → CSS modules
12. Pricing card enhancements
13. Typography scale implementation