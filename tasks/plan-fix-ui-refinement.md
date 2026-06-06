# План исправления проблем UI Refinement

## Контекст
Этот план создан для исправления всех выявленных проблем в ходе UI refinement, включая критические проблемы с доступностью, важные проблемы с CSS переменными и улучшения производительности. Цель - сделать ядро готовым к автономной работе со стабильным качественным результатом.

## Обзор проблем

### Критические (Critical)
1. **Form Labels** - Форма использует `<span>` вместо `<label>` с `htmlFor`/`id`
   - Файл: `apps/web/app/page.tsx:265-286`
   - Влияние: Нарушает доступность, форма недоступна для скринридеров

### Важные (Important)  
2. **CSS Variables** - Переменные `--c-text-primary` и `--radius-pill` не определены
   - Файл: `apps/web/app/ui/page-primitives.module.css:379, 408`
   - Влияние: Fallback значения могут вызывать несоответствия стилей

3. **Inline Styles** - Gate badges используют inline стили вместо CSS классов
   - Файл: `apps/web/app/page.tsx:520-524`
   - Влияние: Нарушает консистентность дизайн-системы

### Средние (Medium)
4. **Performance** - Оптимизация анимаций и backdrop-filter
5. **Accessibility** - Добавление `:focus-visible` и `prefers-reduced-motion`

## План реализации

### Фаза 1: Критические исправления (60 минут)

#### Задача 1.1: Исправить form labels
**Цель**: Заменить все `<span>` с `.fieldLabel` на proper `<label>` с `htmlFor`/`id`

**Файлы для изменения**:
- `apps/web/app/page.tsx:265-286`

**Шаги**:
1. Найти все поля формы с `<span className={ppStyles.fieldLabel}>`
2. Заменить на `<label htmlFor="input-id">`
3. Добавить `id` к соответствующим input элементам
4. Сохранить существующие стили через CSS класс

**Пример реализации**:
```tsx
// До:
<label className={ppStyles.field}>
  <span className={ppStyles.fieldLabel}>Специализация</span>
  <input ... />
</label>

// После:
<label htmlFor="specialization" className={ppStyles.field}>
  <span className={ppStyles.fieldLabel}>Специализация</span>
  <input id="specialization" ... />
</label>
```

**Верификация**:
- [ ] Проверить что все label имеют htmlFor
- [ ] Проверить что все input имеют соответствующий id
- [ ] Протестировать с экранным диктором

#### Задача 1.2: Добавить missing CSS variables
**Цель**: Определить отсутствующие CSS переменные

**Файлы для изменения**:
- `apps/web/app/ui/page-primitives.module.css`

**Шаги**:
1. Добавить :root секцию в начало файла
2. Определить все отсутствующие переменные
3. Заменить fallback значения там где необходимо

**Пример реализации**:
```css
:root {
  /* Colors */
  --c-text-primary: #0f172a;
  --c-text-secondary: #475569;
  --c-text-muted: #667085;
  --c-bg-page: #f8fbff;
  --c-bg-card: rgba(255, 255, 255, 0.94);
  --c-border: rgba(15, 23, 42, 0.08);
  --c-brand: #1d4ed8;
  --c-accent: #1e40af;
  
  /* Spacing */
  --space-section: 18px;
  --space-card-padding: 24px;
  --space-card-padding-lg: 32px;
  
  /* Radius */
  --radius-card: 24px;
  --radius-card-sm: 18px;
  --radius-pill: 999px;
}
```

**Верификация**:
- [ ] Проверить что все переменные определены
- [ ] Запустить npm run check
- [ ] Проверить визуальный рендеринг

### Фаза 2: Важные исправления (45 минут)

#### Задача 2.1: Мигрировать gate badge в CSS классы
**Цель**: Заменить inline стили на CSS классы с data-атрибутами

**Файлы для изменения**:
- `apps/web/app/page.tsx`
- `apps/web/app/ui/page-primitives.module.css`

**Шаги**:
1. Добавить CSS класс для gate badge в page-primitives.module.css
2. Использовать data-атрибуты для разных состояний
3. Упростить GATE_CONFIG до только значений цвета

**Пример реализации**:
```css
/* В page-primitives.module.css */
.gateBadge {
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: 0.75rem;
  font-weight: 600;
}

.gateBadge[data-gate="A"] {
  background: var(--gate-a-bg, #d1fae5);
  color: var(--gate-a-color, #065f46);
}
```

```tsx
// В page.tsx
const GATE_CONFIG: Record<string, { color: string; bg: string }> = {
  A: { color: '#065f46', bg: '#d1fae5' },
  // ...
};

// Использование:
<span className={ppStyles.gateBadge} data-gate={item.confidence_gate}>
  {GATE_CONFIG[item.confidence_gate].label}
</span>
```

**Верификация**:
- [ ] Проверить визуальное соответствие
- [ ] Проверить accessibility attributes
- [ ] Протестировать на разных размерах экрана

### Фаза 3: Улучшения производительности (30 минут)

#### Задача 3.1: Оптимизация CSS
**Цель**: Улучшить производительность CSS

**Файлы для изменения**:
- `apps/web/app/ui/page-primitives.module.css`

**Шаги**:
1. Добавить `will-change` для анимированных элементов
2. Оптимизировать backdrop-filter
3. Добавить `contain: layout paint` для карточек

**Пример реализации**:
```css
.surfaceCard {
  contain: layout paint;
  will-change: transform;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

@media (prefers-reduced-motion: reduce) {
  .surfaceCard,
  .primaryAction {
    transition: none;
  }
}
```

**Верификация**:
- [ ] Запустить Lighthouse audit
- [ ] Проверить производительность на мобильных устройствах
- [ ] Проверить prefers-reduced-motion

### Фаза 4: Финальная проверка (15 минут)

#### Задача 4.1: Комплексное тестирование
**Шаги**:
1. Запустить полный тестовый набор
2. Проверить responsive behavior
3. Verify accessibility compliance
4. Проверить консистентность дизайн-системы

**Команды для проверки**:
```bash
npm run check
npm run build
npx playwright test --headed
```

## Зависимости

- Задачи Фазы 1 должны быть выполнены первыми (критически важны)
- Задачи Фазы 2 зависят от Фазы 1
- Задачи Фазы 3 могут выполняться параллельно с Фазой 2
- Фаза 4 выполняется после всех предыдущих

## Критические файлы для модификации

1. `apps/web/app/page.tsx` - Основные изменения формы и gate badge
2. `apps/web/app/ui/page-primitives.module.css` - CSS variables и стили
3. `apps/web/app/layout.tsx` - Проверка интеграции шрифтов

## Риски и смягчение

**Риск**: Сломать существующую функциональность
- **Смягчение**: Тестируем поэтапно, используем feature flags

**Риск**: Performance degradation
- **Смягчение**: Тестируем на реальных устройствах, используем Lighthouse

**Риск**: Accessibility regression
- **Смягчение**: Тестируем с экранными дикторами, используем axe-core

## Критерии успешного завершения

- [ ] Все TypeScript ошибки исправлены
- [ ] Form labels properly associated with inputs
- [ ] CSS variables consistently used
- [ ] No inline styles in components
- [ ] Lighthouse score > 90
- [ ] WCAG AA compliance verified
- [ ] Responsive behavior tested on real devices

## Следующие шаги

После завершения этого плана рекомендуе��ся:
1. Добавить visual regression tests
2. Создать documentation для дизайн-системы
3. Implement component storybook
4. Setup automated accessibility checks