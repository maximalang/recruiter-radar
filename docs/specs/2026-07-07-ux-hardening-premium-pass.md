# Спецификация: UX Hardening — Premium Pass (онбординг → ежедневная работа)

**Версия:** 1.0
**Дата:** 2026-07-07
**Статус:** Draft — implementation-ready, ожидает подтверждения перед реализацией
**Тип:** UX/product spec (не архитектурный, не scoring)

> Это **спецификация следующего блока UX-работы**, а не план реализации и не брейншторм.
> Каждый пункт ниже соотнесён с конкретными файлами и текущим состоянием кода,
> проверенным через CodeGraph и чтение сурсов 2026-07-07. Реализация по этому
> спеку идёт отдельной сессией через `/plan` → `/build` → `/test` → `/review`.

---

## 1. Problem statement

Recruiter Radar прошёл несколько точечных UX-проходов: миграция emoji → inline-SVG
иконки (`app/ui/icons.tsx`, 27 глифов), премиум-форматирование Telegram-дайджеста
(`lib/telegram/digest-batch.ts`), редизайн профиля/фильтров, очистка декоративных
emoji. Но продукт всё ещё **не ощущается цельным премиум-инструментом от онбординга
до ежедневного использования** — разные поверхности говорят на разном визуальном
языке, и несколько конкретных разрывов бьют по доверию и спокойствию.

Зафиксированные разрывы (каждый подтверждён в коде на 2026-07-07):

1. **Навигация и back-ссылки используют литеральные символы стрелок, а не SVG.**
   `TopNav` рендерит бренд как `← Recruiter Radar` (`internal-page.tsx:85`),
   `InternalBackLink` на lead-detail рендерит `← Лиды` (`leads/[id]/page.tsx:183`),
   back-link на онбординге — `На главную` без иконки. Это единственный класс
   элементов, где emoji-миграция не дошла — продукт говорит «почти премиум».

2. **Empty-state API принимает `icon?: string`, но никто его не передаёт**
   (`internal-page.tsx:534`). Все пустые состояния на `/leads`, `/review`,
   `/settings/profile`, dashboard-today-radar рендерятся **только текстом** — без
   иконки, без визуальной опоры. Свойство фактически мёртвое, а пустые экраны —
   самый уязвимый момент для ощущения «сломалось / пусто».

3. **Profile-completion checklist использует литералы `✓` / `○`**
   (`profile-completion-panel.tsx:42`) вместо SVG `CheckIcon`. Единственный экран
   настроек, где иконка не из новой системы — бьёт по когерентности именно там,
   где пользователь впервые оценивает «настроил ли я всё».

4. **Dashboard analytics — единственная поверхность с legacy `<table>` и
   горизонтальным скроллом на мобильном** (`dashboard-analytics.tsx`: source
   performance, source evidence quality). Весь остальной продукт — премиум-карточки;
   эти две таблицы на телефоне превращаются в «двигай пальцем вбок», что прямо
   противоречит приоритету mobile-readability. У них также **нет skeleton-фолбэка**
   (overview/quality skeletons есть, analytics — нет).

5. **Dashboard funnel color/icon map ссылается на legacy-значения enum**, которых
   уже нет в `digest_feedback_status` (`dashboard-analytics.tsx:76-96`:
   `accepted/later/call/client`). Согласно памяти `project_feedback_enum_drift`,
   DB-enum теперь `none/contacted/replied/won/badfit/snooze/dismissed` (7), а
   in-app writer пишет только DB-legal набор. Карта воронки отображает статусы,
   которые больше не появляются → визуально «мёртвые» ключи и риск показа
   неактуальной цветовой легенды.

6. **Онбординг-визард хорош структурно, но тяжеловесен на первом шаге**
   (`onboarding/pilot/[orderId]/page.tsx`). `confirm-profile` открывает огромную
   форму внутри `<details>` (роли, отрасли × 2, размеры, 4 textarea, политика
   контактов). First-value flow просит «оставьте только то, что реально меняет
   подборку», но форма противоречит этому объёмом. Step-rail (`01–04`) плоский,
   без SVG-индикаторов завершения.

7. **Leads-list читается хорошо, но filter bar не показывает active-состояние
   визуально на селектах** (`leads-filters.tsx`). Активность фильтра видна только
   по тексту `(фильтр активен)` в subtitle и кнопке `Сбросить фильтры`. На
   мобильном два `<select>` подряд — не premium, не сканируется.

8. **Lead-detail иерархия выстроена (verdict hero → why-now → fit → summary →
   contact → evidence → AI → risks), но verdict-chips row может нести 6+ чипов
   одновременно** (band + gate + foreign + review + urgency + freshness), которые
   на мобильном оборачиваются в плотный блок без визуальной группировки
   «решение» vs «метаданные».

9. **Review queue** переиспользует lead-card vocabulary (хорошо), но
   `ForeignEmployerBadge isForeign={false}` захардкожен (`review/page.tsx:101`) —
   foreign-сигнал на review всегда невидим, хотя именно foreign/single-source —
   причина попадания в очередь. Подзаголовок объясняет правила очереди, но
   карточка не показывает, **какое именно правило** привело кандидата сюда.

10. **Telegram-дайджест** уже премиум (`digest-batch.ts`), но readiness-line
    «Готов к контакту · A · Горячий · сигнал 3.2» перегружена тремя readouts
    confidence в одной строке. На узком Telegram-экране это снижает scannability.

В сумме: продукт «почти премиум», но на 8 поверхностях остаются точечные
разрывы визуального языка, mobile-readability и состояния пустоты/загрузки,
которые вместе удерживают ощущение «пилот, а не рабочий инструмент».

---

## 2. Objective

Сделать так, чтобы рекрутинговое агентство, пройдя путь от лендинга через
онбординг к первому радару и ежедневной работе, на каждой поверхности
чувствовало: **спокойно, понятно, премиум, всё на месте** — без визуального
шума, без «сломалось», без разных языков в разных частях продукта.

Это **UX-hardening pass**, а не редизайн: мы усиливаем существующий дизайн-язык
(токены `page-primitives.module.css`, `internal-page.module.css`, SVG-иконки
`app/ui/icons.tsx`) и наводим когерентность на 8 поверхностях. Новый
дизайн-язык НЕ вводится.

---

## 3. User goals

Целевой пользователь — российское рекрутинговое агентство (1–30 человек),
преимущественно с телефона, в режиме «открыл утром → забрал в работу → закрыл».

- **G1.** Войти в онбординг и за ≤3 минуты дойти до первого радара, не путаясь в
  объёме настроек. Первый шаг не должен пугать формой на 12 полей.
- **G2.** Настроить профиль и **сразу увидеть**, что радар под это сработает
  (completion + live match-count уже есть — цель: чтобы они читались как премиум,
  не как отладочный чек-лист с `✓/○`).
- **G3.** На `/leads` утром за 5 секунд сканировать вертикальный список и понять
  приоритет без открытия карточки. Фильтры — видимо, понятно, сбрасываются
  предсказуемо.
- **G4.** На lead-detail за 2 секунды увидеть вердикт (горит/нет, готов к
  контакту, почему сейчас) и безопасный путь, отделённый от метаданных.
- **G5.** На `/review` за один взгляд понять, **почему** кандидат здесь
  (foreign / single-source / gate C) — не только «на проверке».
- **G6.** На `/dashboard` сначала увидеть «что делать сегодня», потом здоровье
  системы — и аналитику, которая читается на телефоне без горизонтального скролла.
- **G7.** В Telegram-дайджесте прочитать карточку за одну строку сканирования:
  компания, готовность, температура — без тройного дублирования confidence.
- **G8.** Никогда не видеть «пусто = сломалось». Каждое пустое/загрузочное/
  ошибочное состояние объясняет, что произошло и какой следующий шаг.

---

## 4. In-scope

Восемь поверхностей, точно названные файлы:

1. **Onboarding / first-value flow** — `app/onboarding/pilot/[orderId]/page.tsx`,
   `pilot-onboarding-components.tsx` (+ `.module.css`), `telegram-step-auto-refresh.tsx`,
   `browser-push-card.tsx`.
2. **Profile/settings UX** — `app/settings/profile/page.tsx`, `profile-form.tsx`
   (+ `.module.css`), `profile-completion-panel.tsx` (+ `.module.css`),
   `delivery-form.tsx`.
3. **Leads list readability & filtering** — `app/leads/page.tsx`,
   `leads-filters.tsx` (+ `.module.css`), `app/ui/internal-page.tsx` (lead-card
   primitives), `app/ui/internal-page.module.css`.
4. **Lead detail hierarchy** — `app/leads/[id]/page.tsx`, `feedback-buttons.tsx`,
   `next-steps-block.tsx`, `ai-enrichment-block.tsx`, `app/ui/internal-page.tsx`
   (verdict region), `app/ui/internal-page.module.css`.
5. **Review queue clarity** — `app/review/page.tsx`, `review-actions.tsx`
   (+ `.module.css`), `app/api/review/route.ts` (data: причина попадания в очередь).
6. **Dashboard hierarchy** — `app/dashboard/page.tsx`,
   `dashboard-overview.tsx`, `dashboard-quality.tsx`, `dashboard-analytics.tsx`,
   `dashboard-today-radar.tsx`, `dashboard-sources.tsx`, `dashboard-alerts.tsx`,
   `dashboard.module.css`.
7. **Telegram digest readability & premium formatting** —
   `lib/telegram/digest-batch.ts`, `lib/telegram/html.ts`,
   `lib/telegram/telegramDigestFeedback.ts` (callback button labels if needed),
   `lib/email/digestEmail.ts` (только если email повторяет ту же структуру —
   привести к одному источнику правды, без нового контента).
8. **Empty / loading / error states across 1–7** — `EmptyState`/`NotFoundState`
   в `app/ui/internal-page.tsx` (+ `.module.css`), `<Suspense>` fallback-строки
   на каждой странице, `NoticeBox` tone-вариации в `app/ui/page-primitives.tsx`.

Also in-scope (cross-cutting enablers, не отдельные фичи):
- **Icon-system completion:** добить SVG-глифы, которых не хватает (back-arrow,
  nav-home, filter, table/list, check-circle для completion), в `app/ui/icons.tsx`
  — строго в существующем стиле (24×24, stroke 1.75, `currentColor`).
- **Dead-prop cleanup:** убрать мёртвый `icon?: string` из `EmptyState` или
  заменить на SVG-компонент (см. §7.8).
- **Enum drift fix:** привести `FUNNEL_COLORS`/`FUNNEL_ICONS` в
  `dashboard-analytics.tsx` к текущему DB-enum (контрактный фикс, не UI-декорация).

---

## 5. Out-of-scope

- **Source/scoring architecture** — FIUR, confidence gates, entity resolution,
  evidence-layer logic, ingest pipeline НЕ трогаем. Спек только про то, как
  существующие данные *показываются*.
- **AI-гиммики** — никаких новых AI-фич, AI-генерации текстов, AI-саммаризаций,
  AI-чатов. Существующий `AiEnrichmentBlock` остаётся как есть (advisory, muted).
- **Новый дизайн-язык** — не вводим новую типографику, новую палитру, новый
  shadow/radius язык, новую сетку. Работаем внутри существующих токенов
  (`--c-*`, `--radius-*`, `--space-*`, gate-colors) и SVG-иконок.
- **Новые поверхности/роуты** — не добавляем новые страницы (нет нового
  `/analytics`, `/inbox`, `/settings/notifications` и т.п.).
- **Биллинг/checkout UI** — `app/checkout/*` вне этого блока (отдельная
  спека, если потребуется).
- **Лендинг (`/`) маркетинговые секции** — hero/value/how/pricing/FAQ остаются
  как есть. Затрагиваем только shared-примитивы, если правка нужна для
  когерентности (например, back-arrow в `backLink`).
- **Backend данных для review-reason** — если API `/api/review` уже отдаёт
  enough signal (source count, foreign flag, gate), UI-вывод делается из
  существующих полей. Новый SQL/JOIN — только если без него буквально нельзя
  показать причину (минимальный, строго read-only).
- **Multitenancy, owner_id, session boundary** — не трогаем (отдельная эпика).
- **Performance/scoring optimisation** — не в этом блоке.
- **n8n workflows** — не трогаем (orchestration-only по CLAUDE.md).

---

## 6. UX principles

Применяются к каждому решению в §7. При конфликте — приоритет сверху вниз.

1. **Calm over clever.** Спокойствие важнее умности. Лучше меньше элементов,
   которые точно на месте, чем больше, которые «крутятся». Анимации — только
   смысловые (progress, reveal), не декоративные. `prefers-reduced-motion`
   уважаем везде (уже частично — держим).
2. **Evidence over decoration.** Каждый визуальный элемент несёт сигнал о
   компании/состоянии. Декоративных emoji/глифов/теней не добавляем. Иконка
   = статус или категория, никогда — украшение.
3. **One visual language.** Все поверхности используют одни токены и один
   SVG-набор. Ни одного литерального символа (`←`, `✓`, `○`, `→` в навигации)
   там, где есть SVG-эквивалент. Exception: `→` внутри meaning-bearing copy
   («Открыть все лиды →» в Telegram anchor) — оставляем как текстовый affordance.
4. **Hierarchy by visual weight, not colour spam.** Решение (verdict, readiness)
   — hero-вес (existing `data-variant="hero"`). Метаданные (freshness, sources)
   — muted. Чипы «решение» и чипы «метаданные» визуально разделены, не в одном
   плоском ряду.
5. **Mobile-first readability.** Каждая поверхность проверяется на 360–414px.
   Никакого горизонтального скролла внутри контента (таблицы → карточные списки
   или responsive columns). Tap-target ≥44px (WCAG 2.5.5) — уже частично,
   доводим до всех интерактивов.
6. **Trust through honesty.** Пустые/ошибочные/частичные состояния говорят
   прямо: «по вашей нише пока мало сигналов», «доказательств немного», «прямой
   путь уточняется». Не маскируем отсутствие данных под «загрузка…» навсегда.
7. **Russian premium copy.** Коротко, конкретно, без хайпа. Запрещено (по
   CLAUDE.md): «гарантированные клиенты», «100% результат», «готовые сделки».
   Предпочитаем: «компании, которым стоит написать сегодня», «доказательства»,
   «почему сейчас», «безопасный путь контакта». Все строки — `ru-RU`,
   mojibake-protected через существующий `repairPossiblyMojibakeText`.
8. **No new deps.** Решаем существующим стеком (Next.js App Router, CSS
   Modules, inline SVG). Новые библиотеки — только с явным оправданием в PR.

---

## 7. Exact surfaces to change

Формат каждой поверхности: **текущее состояние → целевое состояние → конкретные
правки → acceptance.** Файлы — абсолютные/проектные пути.

### 7.1 Onboarding / first-value flow

**Текущее:** 4-шаговый wizard (confirm-profile → telegram → preview → complete)
внутри одной `SurfaceCard`. Step-rail — плоские pills `01–04` с text-only
`data-current`/`data-complete`. Шаг 1: массивная форма внутри `<details>` (роли,
2× отрасли, размеры, 4 textarea, политика). `ThreeQuestionPanel` сверху даёт
фокус шага. `InstructionCard` на шаге 2 — нумерованные текстовые карточки.

**Целевое:**
- Step-rail: каждый шаг несёт SVG-иконку (`IndustryIcon`/`ChatIcon`/
  `TargetIcon`/`CheckIcon`) + номер; completed-шаг показывает `CheckIcon` в
  brand-тоне, current — brand-ring, future — muted. Сохранить существующий
  `data-current`/`data-complete` контракт (CSS-вариации), только добавить
  иконку в `stepPill`.
- Шаг 1: форма остаётся, но визуально разделена на «обязательное для первого
  радара» (название, где искать, что искать, роли — видимы сразу) и
  «уточнить позже» (`<details>` с отраслями/исключениями/размерами). Существующая
  структура `<details>` сохраняется — правим только copy-веса и order, не
  поля. Helper-text под кнопкой: «Дальше подключим Telegram» — уже есть,
  оставляем.
- Шаг 2: `InstructionCard` — добавить SVG-нумерацию (1/2/3 в circle) вместо
  текстовых «1./2./3.». CTA «Открыть Telegram» — добавить `ChatIcon` (semantic,
  не декоративный).
- Шаг 3 (preview): `OnboardingPreviewCard` использует `scorePill` с текстом
  «score 3.2». Привести к общему `ScoreBandChip`-языку («Горячий/Тёплый/
  Холодный» + signal strength), чтобы онбординг-превью и `/leads` говорили
  одинаково. Не плодить второй score-vocab в онбординге.
- Шаг 4 (complete): «Пилот запущен» — `CheckIcon` semantic badge вместо
  `StatusBadge tone="success"` text-only. Web-push disclosure — оставить.

**Правки:** `onboarding/pilot/[orderId]/page.tsx` (step-rail render,
preview-card score vocab, instruction numbering),
`pilot-onboarding-components.tsx` + `.module.css` (stepPill icon slot,
InstructionCard number-circle), `app/ui/icons.tsx` (если нужен new glyph —
минимум).

**Acceptance:**
- Step-rail рендерит SVG-иконку на каждом шаге; completed = `CheckIcon` brand.
- Онбординг-превью карточка использует тот же band-vocab (`scoreBand`), что
  `/leads` (один `score-display.ts` источник).
- На 375px ширины шаг 1 не требует горизонтального скролла; обязательные поля
  видимы без раскрытия `<details>`.

---

### 7.2 Profile / settings UX

**Текущее:** `ProfileCompletionPanel` — progress bar + чек-лист с литералами
`✓`/`○` (`profile-completion-panel.tsx:42`), затем `preview`-блок с
match-count. `ProfileForm` — большая форма с hiring-mode badge. `DeliveryForm`
— отдельная `ContentCard`.

**Целевое:**
- Чек-лист: литералы `✓`/`○` → SVG `CheckIcon` (filled) для filled,
  пустой circle (новый `CircleIcon` glyph, 24×24 stroke 1.75) для unfilled.
  `data-filled` контракт сохраняется.
- Completion-panel: визуально премиум — existing bar остаётся; per-item
  `CheckIcon` получает brand-тон для filled, muted для unfilled.
- Match-count preview: «≈N компаний сейчас подходят» — сохранить честный
  empty-state copy («Пока ни одной… фильтры слишком узкие»), добавить
  `SearchIcon` semantic перед строкой, чтобы preview читался как «проверка
  радара», а не как отладочный вывод.
- `ProfileForm`: hiring-mode badge («Сейчас действует: specialist/executive/
  volume») — убедиться, что он несёт SVG (`TargetIcon`/`BriefcaseIcon`/
  `TrendIcon`) semantic, не text-only. Форму не реструктурируем.
- `DeliveryForm`: проверить, что channel-toggles (Telegram/push/email) несут
  semantic иконки (`ChatIcon`/`MailIcon`/`BellIcon` — `BellIcon` возможно
  добавить). Структуру не меняем.

**Правки:** `profile-completion-panel.tsx` (+ `.module.css` для `.checkIcon`
→ SVG sizing), `profile-form.tsx`, `delivery-form.tsx`, `app/ui/icons.tsx`
(`CircleIcon`, `BellIcon` если нужно).

**Acceptance:**
- Ни одного литерала `✓`/`○` в completion-panel; все иконки — SVG из
  `app/ui/icons.tsx`.
- Match-count preview несёт semantic `SearchIcon`.
- На 375px completion-panel и form не скроллятся горизонтально; tap-targetы
  ≥44px.

---

### 7.3 Leads list readability & filtering UX

**Текущее:** premium `leadCard` с priority-rail, head (org + tag-chips + score),
две field-rows (fit / why), footer (urgency + freshness + contact + location +
vacancies + roles), risk-row, action-column «Открыть →». `LeadsFilters` —
profile-select (durable) + gate-select + feedback-select (ephemeral) + today-toggle
+ reset. Active-filter виден только текстом `(фильтр активен)` и кнопкой reset.
Legend (высокий/средний/низкий) в toolbar.

**Целевое:**
- **Filter active-state:** селекты с активным значением получают
  `data-active="true"` → brand-tinted border/bg (новая CSS-вариация в
  `leads-filters.module.css`, контракт `data-active`). Сегодня активность
  скрыта — на mobile это «не видно, что фильтрую».
- **Today-toggle:** уже `data-active` → убедиться, что active-стиль премиум
  (brand-fill, `CheckIcon` semantic), не просто инверсия.
- **Reset button:** добавить `XIcon` semantic + уточнить copy «Сбросить
  фильтры» → оставить (хорошо), но иконку добавить.
- **Lead-card chip grouping:** head-tags сейчас плоский ряд (band, gate,
  foreign, review, feedback, AI-hint). Группировать визуально: «решение»
  (band + gate) слева, «статус работы» (review + feedback) справа, AI-hint
  и foreign — отдельные muted-чипы. Решение через CSS `gap` + visual-divider
  в `.leadCardTags`, не через новый компонент.
- **Score column** (`leadCardHeadAside`, 150px): на mobile уже collapses —
  ок. На desktop убедиться, что `ScoreBar` + `ScoreBandChip` не дублируют
  температуру дважды (chip = band label, bar = numeric strength) —
  оставить, но проверить, что они читаются как «одно».
- **Legend** (высокий/средний/низкий): на mobile уже column-стек; добавить
  `sr-only` label-связку с rail-тонами для a11y (сегодня `aria-hidden`).

**Правки:** `leads-filters.tsx` + `leads-filters.module.css` (active-state),
`app/leads/page.tsx` (chip grouping markup), `app/ui/internal-page.module.css`
(`.leadCardTags` grouping), `app/ui/internal-page.tsx` (если нужен
chip-group wrapper).

**Acceptance:**
- Активный селект визуально отличим от неактивного на 375px без чтения текста.
- Card head имеет 2 визуальные группы чипов (решение / статус) — divider или
  gap-difference, не плоский ряд.
- Legend связан с rail-тонами через a11y-label (не `aria-hidden` слепой).
- `npm run web:check` чисто; существующие leads-тесты зелёные.

---

### 7.4 Lead detail hierarchy

**Текущее:** `DetailLayout` (main 1fr + sidebar 300px, collapses на 768px).
Main: verdict-hero (ScoreGauge + 6 chips + roles) → why-now → fit (hero) →
company summary → contact path → evidence → AI → risks. Sidebar: next-steps →
gate-explain → feedback → sources → company. Back-link `← Лиды` (literal).

**Целевое:**
- **Verdict-chips grouping:** 6+ chips в `.leadVerdictChips` → разделить на
  «решение» (band, gate, urgency) и «метаданные» (foreign, review,
  freshness). CSS: две подгруппы с subtle gap/divider. Не плодить новые
  компоненты — `<div className={ipStyles.verdictChipsDecision}>…</div>`
  + `<div className={ipStyles.verdictChipsMeta}>…</div>` в existing card.
- **ScoreGauge:** circle (80px) + level-label + bar. На mobile уже 64px — ок.
  Проверить, что `scoreBand`-label (Горячий/Тёплый) и `scoreLevelLabel`
  (Высокий/Средний) не дублируются рядом — сегодня band в chip, level в
  gauge-info; если оба видны одновременно на mobile — оставить только band
  (более «человеческий» read), level в `sr-only`.
- **Why-now card (hero):** уже `data-variant="hero"` — ок. Добавить
  semantic `FlameIcon`/`TrendIcon` в title-row только если urgency-level
  совпадает (semantic, не декорация); иначе без иконки.
- **Back-link:** `← Лиды` → SVG `BackIcon` (новый glyph, arrow-left 24×24)
  + «Лиды». То же для not-found state.
- **Sidebar order:** next-steps → gate → feedback → sources → company —
  оставить (правильный приоритет: действие → доверие → статус → источники →
  реквизиты).
- **Next-steps block:** `NextStepsBlock` — убедиться, что copy/CRM-block
  и links несут semantic иконки (`LinkIcon` для сайта/карьерной,
  `FileIcon` для CSV). Структуру не меняем.
- **Feedback buttons:** проверить, что каждая кнопка несёт SVG из
  `FEEDBACK_LABELS`-map (сегодня map есть, но `FeedbackButtons`-компонент —
  проверить рендер). Enum drift: только DB-legal набор (`contacted/replied/
  won/badfit/snooze/dismissed`) — уже по памяти `project_feedback_enum_drift`.

**Правки:** `app/leads/[id]/page.tsx` (verdict grouping, back-link),
`app/ui/internal-page.module.css` (`verdictChipsDecision/Meta`,
`scoreGauge` mobile), `app/ui/internal-page.tsx` (back-link → SVG),
`next-steps-block.tsx`, `feedback-buttons.tsx`, `app/ui/icons.tsx` (`BackIcon`).

**Acceptance:**
- Verdict-chips разделены на 2 группы на всех breakpoints; на 375px группы
  стекаются, но остаются визуально разделены.
- Back-link несёт SVG `BackIcon`, не литерал `←`.
- ScoreGauge на mobile показывает band-label видимым, level-label в `sr-only`.
- `npm run web:check` чисто; lead-detail рендерит без layout-shift (verdict
  grouping — статичная разметка, не async).

---

### 7.5 Review queue clarity

**Текущее:** `/review` переиспользует `leadCard` (хорошо). `ReviewCard` рендерит
band + gate + `ForeignEmployerBadge isForeign={false}` (захардкожено →
foreign-сигнал НИКОГДА не виден на review, хотя foreign — причина попадания).
Metric «На проверке». Profile-select (если >1 профилей). `ReviewActions`
(approve/reject) в footer.

**Целевое:**
- **Review-reason badge:** на каждой `ReviewCard` показать **почему** кандидат
  здесь — один из: `gate C` / `foreign ATS` / `single source` / `иностранный
  работодатель`. Источник: existing fields в `ReviewCandidate` (`confidenceGate`,
  `sourceFamilies.length`, + нужен `isForeignEmployer` из API если есть).
  Новый `ReviewReasonChip` (semantic: `AlertIcon` для needs-check,
  `GlobeIcon` для foreign, `LayersIcon` для single-source) в `.leadCardTags`.
- **Foreign-employer:** убрать хардкод `isForeign={false}`, брать из данных
  (`ReviewCandidate.isForeignEmployer` — добавить поле в API-ответ
  `/api/review` если отсутствует; read-only, без нового SQL-rewrite —
  использовать existing `is_foreign_employer` на digest_candidates если есть,
  иначе вывести из geo-gate logic по existing `locationNames`/source).
- **Subtitle:** existing «Кандидаты с уверенностью C, иностранные работодатели
  и одиночный источник…» — оставить, но визуально подкрепить reason-chip на
  карточке.
- **ReviewActions:** approve/reject — semantic `CheckIcon`/`XIcon` (проверить
  рендер), premium button-styling (не дефолтные browser-кнопки). Idempotent
  контракт (по CLAUDE.md /review callback) — не трогаем, только визуал.
- **Empty state:** «Очередь пуста» — existing copy хороший; добавить semantic
  `CheckIcon` в circle («всё проверено/чисто») вместо text-only.

**Правки:** `app/review/page.tsx` (ReviewReasonChip, foreign from data),
`review-actions.tsx` + `.module.css` (button styling + icons),
`app/api/review/route.ts` (добавить `isForeignEmployer` + ideally
`reviewReason` в ответ, если не выводится на клиенте — **минимальный read-only
change**, без нового JOIN если возможно), `app/ui/internal-page.tsx`
(`ReviewReasonChip` если делаем общим), `app/ui/icons.tsx` (если нужен glyph).

**Acceptance:**
- Каждая `ReviewCard` несёт ровно один reason-chip с правильной иконкой.
- Foreign-сигнал виден на review, когда кандидат реально foreign (не захардкожен
  false).
- `ReviewActions` кнопки premium, ≥44px tap-target, semantic icons.
- `/api/review` изменение обратно-совместимо (новые поля опциональны, старые
  клиенты не ломаются) — CodeGraph `codegraph_impact` на изменённый route.

---

### 7.6 Dashboard hierarchy

**Текущее:** 2-зонная иерархия (agency value: today-radar + quality + analytics)
→ (system: overview + sources + alerts). `DashboardTodayRadar` — premium cards
(хорошо). `DashboardQuality` — skeleton + gate-distribution (хорошо).
`DashboardAnalytics` — **legacy `<table>` для source-perf и source-evidence-quality
(горизонтальный скролл на mobile), нет skeleton, legacy funnel enum-map**.

**Целевое:**
- **Analytics tables → responsive card-list on mobile:** `sourcePerfTable` и
  `sourceEvidenceQuality` таблицы — на ≤768px рендерить как карточный список
  (один источник = одна карточка с label-value rows), на desktop сохранить
  таблицу. Решение: либо CSS `@media` (tr → display:block, td → grid rows),
  либо отдельный mobile-markup. Предпочесть CSS-only (без дублирования разметки).
- **Funnel enum fix:** `FUNNEL_COLORS`/`FUNNEL_ICONS` → текущий DB-enum
  (`contacted/replied/won/badfit/snooze/dismissed`). Legacy keys (`accepted/
  later/call/client`) убрать или замаппить на текущие (display-tolerance для
  historical rows, как `FEEDBACK_LABELS` в internal-page). Контрактный фикс.
- **Analytics skeleton:** добавить `AnalyticsSkeleton` (по образцу
  `QualitySkeleton`/`OverviewSkeleton`) для `<Suspense>` фолбэка — сегодня
  analytics под `Suspense` без skeleton, виден `null`/flash.
- **Today-radar:** уже премиум — оставить. Проверить, что empty-state
  («Пока нет компаний для контакта…») несёт semantic иконку (`SearchIcon`/
  `TargetIcon`), не text-only.
- **Zone labels:** existing «Система и источники» zone-label — ок. Убедиться,
  что agency-value zone не имеет избыточного лейбла (сегодня без — хорошо,
  top-of-page = value by convention).
- **Metric cards consistency:** `DashboardOverview` uses `.metricCard` from
  `dashboard.module.css` (separate from `MetricCard` primitive in
  `internal-page.tsx`). Проверить, что они визуально когерентны (radius,
  border, shadow) — если дрифт, привести к одному (не объединять компоненты,
  только CSS-консистентность).

**Правки:** `dashboard-analytics.tsx` (table→responsive, funnel enum, skeleton),
`dashboard.module.css` (`@media` responsive tables, analytics skeleton styles,
metric-card consistency), `dashboard-today-radar.tsx` (empty-state icon),
`dashboard-overview.tsx`/`dashboard-quality.tsx` (только если metric-card
consistency требует).

**Acceptance:**
- На 375px `dashboard-analytics` source-perf и evidence-quality не имеют
  горизонтального скролла; читается как карточный список.
- `FUNNEL_COLORS`/`FUNNEL_ICONS` содержат только DB-legal keys (+ optional
  legacy-display mapping); новых «мёртвых» ключей нет.
- Analytics под `<Suspense>` показывает skeleton, не белый flash.
- Zone-иерархия «value → system» сохранена; today-radar остаётся первым блоком.
- `npm run web:check` чисто; dashboard рендерит без layout-shift на skeleton.

---

### 7.7 Telegram digest readability & premium formatting

**Текущее:** `digest-batch.ts` — executive brief, ≤2 messages × 4096 chars.
Per-lead block: `1. <b>Ромашка</b> · Москва` → `Готов к контакту · A · Горячий ·
сигнал 3.2` → whyLine → urgency → roles → contact → sources. Header:
`Радар · 7 июля\nN компаний с сигналом найма`. Footer: `Открыть все лиды →`.

**Целевое:**
- **Readiness line de-duplication:** сегодня `Готов к контакту · A · Горячий ·
  сигнал 3.2` — три readouts confidence (label + gate-letter + band + numeric).
  Сократить до **двух**: readiness-label + band + numeric, gate-letter
  убрать из этой строки (gate уже закодирован в readiness-label «Готов к
  контакту»/«На проверку»). Альтернатива: `Готов к контакту · Горячий · 3.2`.
  Gate-letter redundant → удалить. Контракт: A/B = «Готов к контакту», C =
  «На проверку» (уже так в `readinessLabel`).
- **Foreign marker:** `· зарубежный ATS` — plain text tag (хорошо, без emoji).
  Оставить. Проверить, что он не дублируется с `foreignMark` в elsewhere.
- **Block spacing:** между блоками `\n\n` (2 newlines) — ок. Внутри блока
  `\n` (1 newline). Проверить на узком Telegram-экране, что 6–7 строк блока
  не сливаются (при необходимости — strategic empty line после title).
- **Roles line:** `Роли: Backend, DevOps + ещё 2 · 4 вак.` — ок, оставить.
  Проверить escape (`escapeHtml` уже применяется).
- **Contact line:** `Контакт: <a>Карьерная страница</a> · romashka.ru` —
  премиум, оставить. Honest fallback «прямой путь уточняется» — оставить.
- **Sources line:** `<i>Источники: career-pages, habr</i>` — italic muted, ок.
- **Header:** `Радар · 7 июля` — ok. Рассмотреть semantic-префикс без emoji
  (сегодня без — хорошо). Не добавлять emoji.
- **Overflow:** `droppedLeads` → footer link «Открыть все лиды →» покрывает —
  ok. Не менять MAX_BATCH_MESSAGES=2 (контракт по памяти `telegram_digest_model`).
- **Callback buttons:** (отдельная поверхность — `telegramDigestFeedback.ts`)
  inline buttons `Беру/Мимо/Позже/Уже написал/Ответили/Созвон/Клиент/Скрыть
  похожие`. Проверить, что labels когерентны с in-app `FEEDBACK_LABELS` и
  DB-enum. Согласно памяти `project_feedback_enum_drift`, Telegram layer maps
  `accepted→contacted` — оставить mapping, не трогать enum. Только если
  label-дрифт виден — поправить copy.

**Правки:** `lib/telegram/digest-batch.ts` (readiness-line de-dup, spacing
check), `lib/telegram/html.ts` (только если escape-контракт меняется — нет),
`lib/telegram/telegramDigestFeedback.ts` (только copy-когерентность, если
нужно), `lib/email/digestEmail.ts` (привести readiness-line к тому же виду,
если повторяет — без нового контента).

**Acceptance:**
- Readiness-line несёт ≤2 confidence readouts (не 3+); gate-letter удалён.
- Все текстовые поля проходят `escapeHtml`; ссылки в `<a href>` с escape.
- 4096-char limit и MAX_BATCH_MESSAGES=2 respected (existing unit-тесты
  `digest-batch` зелёные — обновить assertions на новый readiness-line).
- Honest fallback «прямой путь уточняется» сохранён; контакты не выдумываются.
- `npm run web:check` чисто; digest-batch unit-тесты обновлены и зелёные.

---

### 7.8 Empty / loading / error states (cross-cutting)

**Текущее:** `EmptyState` (`icon?: string` — мёртвое свойство, никто не передаёт),
`NotFoundState`, `NoticeBox` (5 tones). `<Suspense>` fallbacks — плоский
`<div>Загрузка...</div>` / `<ContentCard>Загрузка…</ContentCard>` на разных
страницах. Dashboard-quality имеет `qualityError` alert; analytics — нет error
path. Loading skeleton-ы есть только у overview/quality.

**Целевое:**
- **`EmptyState` API cleanup:** убрать мёртвый `icon?: string` → заменить на
  `icon?: keyof typeof ICONS` или `ReactElement` (SVG-компонент). Все 8
  empty-states (leads ×4, review ×2, settings ×1, today-radar ×1) получают
  semantic SVG-иконку. **Это breaking-change сигнатуры** → CodeGraph
  `codegraph_impact` на `EmptyState` перед правкой; обновить всех callers в
  этом же PR.
- **Empty-state content:** каждый empty-state уже несёт honest copy + action
  (хорошо — `leads/page.tsx:183` даёт 4 варианта). Добавить только иконку +
  сохранить existing copy/actions. Не переписывать тексты.
- **Loading states:** единый `LoadingState` primitive (в `internal-page.tsx`)
  с skeleton-вариантом (не «Загрузка…» текст). Заменить плоские
  `<div>Загрузка...</div>` на `<LoadingState variant="skeleton|inline" />`.
  Dashboard-analytics получает skeleton (см. §7.6).
- **Error states:** каждая страница, где данные могут упасть (leads, review,
  dashboard), несёт `NoticeBox tone="danger"` с: что случилось + что делать
  (обновить / попробовать позже / написать поддержку). Today-radar уже ловит
  `previewError` — паттерн перенести на analytics. Не показывать raw
  `error.message` пользователю (только log + human copy).
- **`NoticeBox` tones:** existing 5 tones (neutral/success/info/warning/danger)
  — ок. Проверить, что neutral-variant несёт muted-стиль (не кричащий).
- **Mojibake protection:** все visible strings через `repairPossiblyMojibakeText`
  (existing pattern в `page-primitives.tsx`/`internal-page.tsx`) — сохранить
  в новых компонентах.

**Правки:** `app/ui/internal-page.tsx` (`EmptyState` API + `LoadingState`),
`app/ui/internal-page.module.css` (skeleton styles, empty-state icon),
`app/leads/page.tsx`/`app/review/page.tsx`/`app/settings/profile/page.tsx`/
`app/dashboard/*.tsx` (Suspense fallbacks → `LoadingState`, empty → icon),
`app/ui/page-primitives.tsx` (если `NoticeBox` нуждается в tweak).

**Acceptance:**
- `EmptyState.icon` — SVG-компонент, не string; все callers передают иконку;
  `codegraph_impact EmptyState` показывает 0 orphaned callers после PR.
- Единый `LoadingState` используется во всех `<Suspense>` fallbacks; ни одного
  плоского `Загрузка…` текста.
- Каждая data-driven поверхность имеет error-path `NoticeBox tone="danger"` с
  human copy + next-step.
- Все visible strings mojibake-protected.
- `npm run web:check` чисто; `web:build` зелёный (если роуты/миддлвэр не
  менялись — достаточно `web:check`).

---

## 8. Acceptance criteria (whole block)

Блок считается выполненным, когда **все** истинны:

- [ ] **AC1.** Ни одного литерального символа-стрелки (`←`) или check/circle
  (`✓`, `○`) в навигации, back-ссылках, completion-checklist. Все — SVG из
  `app/ui/icons.tsx`. (grep по `app/` → 0 совпадений вне string-literals в
  meaning-bearing copy.)
- [ ] **AC2.** `EmptyState` принимает SVG-иконку; все 8 empty-states её
  передают; `codegraph_impact EmptyState` → 0 orphaned callers.
- [ ] **AC3.** Все 8 поверхностей проверены на 375px viewport: ни одного
  горизонтального скролла внутри контента; все interactive элементы ≥44px
  tap-target.
- [ ] **AC4.** Dashboard analytics: таблицы source-perf и evidence-quality
  рендерятся карточным списком на ≤768px; skeleton под `<Suspense>`; funnel
  enum-map содержит только DB-legal keys (+ optional legacy display-mapping).
- [ ] **AC5.** Review queue: каждая карточка несёт ровно один reason-chip;
  foreign-сигнал виден из данных (не хардкод false).
- [ ] **AC6.** Telegram readiness-line несёт ≤2 confidence readouts; gate-letter
  удалён; `digest-batch` unit-тесты обновлены и зелёные; 4096/2-message
  контракт сохранён.
- [ ] **AC7.** Lead-detail verdict-chips разделены на 2 группы (решение /
  метаданные) на всех breakpoints; ScoreGauge на mobile — band видим, level
  в `sr-only`.
- [ ] **AC8.** Единый `LoadingState` во всех `<Suspense>` fallbacks; ни одного
  плоского `Загрузка…` текста.
- [ ] **AC9.** `npm run web:check` чисто. Если менялись роуты/`next.config`/
  middleware — `npm run web:build` зелёный (по CLAUDE.md validation gate).
- [ ] **AC10.** Все новые/изменённые visible строки — `ru-RU`, mojibake-
  protected, соответствуют premium-copy правилам (CLAUDE.md §Code Standards).
- [ ] **AC11.** Pre-merge gate (CLAUDE.md) пройден: `/review` пяти-осевой,
  `codegraph_impact` на каждом изменённом exported symbol, signature-diff
  зафиксирован. `EmptyState` signature-change явно отмечен в commit/PR.
- [ ] **AC12.** Ни одного нового dependency в `package.json` (или явное
  оправдание в PR).

---

## 9. Verification criteria

Как именно проверяем (не «что», а «как»):

- **Static:** `npm run web:check` (tsc + lint). CodeGraph `codegraph_impact` на
  `EmptyState`, `MetricCard`, `ScoreGauge`, `ScoreBandChip`, `formatBatchLeadBlock`,
  `/api/review` route handler — orphaned callers = 0.
- **Unit:** `apps/web` jest (из `apps/web` cwd, не repo-root — по памяти
  `feedback_jest_cwd`). Обновить assertions для `digest-batch` (readiness-line),
  `dashboard-analytics` (funnel enum), `profile-completion` (icon render).
  Jest-mock hoisting trap — по памяти `feedback_jest_mock_hoisting`.
- **Build:** `npm run web:build` только если §AC9 требует (роуты/миддлвэр/
  next.config). Иначе — `web:check` достаточно.
- **Visual regression (manual, env-limited):** по памяти `feedback_no_vision`
  daemon блокирует images → верифицируем через Playwright DOM/computed-styles
  + user eyeballs на скриншотах. Проверить 375px и 1280px для каждой из 8
  поверхностей; зафиксировать отсутствие horizontal-scroll
  (`document.documentElement.scrollWidth <= window.innerWidth`).
- **Telegram digest:** unit-тесты `digest-batch` покрывают readiness-line,
  4096-overflow, foreign-marker, honest-contact-fallback. Реальная отправка —
  не в этом блоке (только composer).
- **A11y:** axe-core (если доступен) или ручная проверка: skip-link, focus-ring
  на всех interactive, `aria-current` на nav (есть), `aria-label` на
  icon-only controls, contrast ≥4.5:1 на chip-текстах (существующие токоны
  уже соответствуют — не вводить новые цвета ниже порога).
- **Mojibake:** проверить, что кириллические строки не проходят через
  inline-`-d` curl/zsh (по памяти `project_rabota_rossii_live`); в коде
  все literals в TSX-файлах, не через shell.

---

## 10. Risks / non-goals

**Risks (real, mitigtion each):**

- **R1. `EmptyState` signature-change — breaking.** Mitigation: CodeGraph
  `codegraph_impact` ДО правки; все callers в том же PR; если callers много —
  поэтапно (deprecate `icon?: string`, add `iconSvg?`, migrate, remove).
- **R2. `/api/review` изменение ответа.** Mitigation: новые поля
  опциональны (`isForeignEmployer?`, `reviewReason?`); обратно-совместимо;
  read-only, без schema-migration; `codegraph_impact` на route handler.
- **R3. Dashboard responsive tables via CSS-only — хрупко.** Mitigation: если
  CSS `tr→block` ломает a11y (role=list семантика), перейти на mobile-markup
  дублирование (простой `@media` swap двух блоков); решение принять на
  `/build`-фазе после проверки Playwright.
- **R4. Telegram readiness-line change → existing unit-тесты красные.**
  Mitigation: обновить assertions в том же PR; это intentional contract-change
  (de-duplication), отметить в commit message.
- **R5. Funnel enum-map change → historical rows display.** Mitigation: legacy
  display-mapping (как `FEEDBACK_LABELS` в internal-page — display-tolerance,
  writer не эммитит legacy); не трогать DB.
- **R6. Scope creep в онбординге (соблазн переделать wizard).** Mitigation:
  §5 out-of-scope жёсткий; правки только visual + score-vocab unification,
  не flow/fields.
- **R7. Icon-set growth — добавить «один ещё» глиф.** Mitigation: §6 principle
  «evidence over decoration»; каждый новый glyph оправдан конкретной
  поверхностью в §7; не добавлять «про запас».
- **R8. Mobile a11y на 375px без vision-proxy.** Mitigation: Playwright
  computed-styles + scrollWidth assert; user eyeballs на финальных скриншотах.

**Non-goals (явно НЕ делаем в этом блоке):**

- Не меняем FIUR scoring, confidence gates, evidence logic, entity resolution.
- Не добавляем AI-фичи/генерацию/саммаризацию.
- Не вводим новый дизайн-язык (типографика, палитра, тени, сетка).
- Не добавляем новые страницы/роуты.
- Не трогаем billing/checkout UI.
- Не трогаем лендинг-маркетинговые секции (только shared-примитивы если нужно).
- Не трогаем n8n workflows, ingest pipeline, source adapters.
- Не делаем cross-source merge / multitenancy / owner_id epics.
- Не делаем schema-migrations (кроме возможного read-only поля в /api/review —
  без DDL).
- Не оптимизируем performance/scoring.
- Не переписываем существующие premium-поверхности (today-radar, lead-card,
  Telegram digest composer) — только точечная когерентность.

---

## 11. Implementation order (suggested, не обязательный)

Подзадачи для `/plan`-фазы. Порядок — по dependency и blast-radius:

1. **Icon-system completion** (`app/ui/icons.tsx`: `BackIcon`, `CircleIcon`,
   `BellIcon` если нужно) — enabler для всех остальных.
2. **Cross-cutting: `EmptyState` API + `LoadingState` primitive** (§7.8) —
   breaking, делать раньше чтобы все поверхности приняли сразу.
3. **Nav/back-link SVG migration** (§7.1 rail + §7.4 back-link + лендинг
   backLink) — small blast-radius, видимый win.
4. **Profile/settings** (§7.2) — completion-panel `✓/○` → SVG.
5. **Leads list filters + chip grouping** (§7.3).
6. **Lead detail verdict grouping + ScoreGauge mobile** (§7.4).
7. **Review queue reason-chip + foreign from data** (§7.5) — включает
   `/api/review` read-only change.
8. **Dashboard analytics responsive + funnel enum + skeleton** (§7.6) —
   самый объёмный, отдельным sub-PR.
9. **Telegram digest readiness-line de-dup** (§7.7) — composer-only,
   unit-tested.
10. **Onboarding score-vocab unification + step-rail icons** (§7.1) — финал,
    зависит от §1 (icons).
11. **Final `/review` (5-axis) + CodeGraph signature-diff + verify-on-device**
    (CLAUDE.md pre-merge gate).

---

## 12. Open questions (resolve before/at `/plan`)

Эти не блокируют принятие спеки, но должны быть решены на planning-фазе:

- **Q1.** `/api/review` уже отдаёт `isForeignEmployer` и enough signal для
  reason-chip, или нужен минимальный read-only change? → проверить
  `app/api/review/route.ts` и `ReviewCandidate` shape на `/plan`.
- **Q2.** Dashboard responsive tables — CSS-only `tr→block` или mobile-markup
  duplication? Решить после Playwright-probe на `/build`.
- **Q3.** `EmptyState` migration — поэтапно (deprecate→migrate→remove) или
  одним breaking PR? Зависит от количества callers (CodeGraph `codegraph_callers
  EmptyState`).
- **Q4.** Email digest (`lib/email/digestEmail.ts`) — повторяет ли readiness-line
  из Telegram? Если да — single source of truth; если отдельная copy — оставить,
  но визуально когерентно.
- **Q5.** `BellIcon` / `CircleIcon` / `BackIcon` — достаточно ли одного нового
  глифа на каждую, или `BackIcon` уже есть (проверить: `icons.tsx` не содержит
  arrow-left на 2026-07-07 — нужен).

---

## 13. Definition of done (блок целиком)

1. Все AC1–AC12 истинны.
2. `npm run web:check` чисто; `web:build` зелёный если §AC9 требует.
3. Unit-тесты `digest-batch`, `dashboard-analytics`, `profile-completion`
   обновлены и зелёные.
4. CodeGraph `codegraph_impact` на `EmptyState`, `formatBatchLeadBlock`,
   `/api/review` handler → 0 orphaned callers; signature-diffs зафиксированы
   в commit/PR.
5. Pre-merge gate (CLAUDE.md §Pre-merge) пройден: `/review` пяти-осевой, все
   Critical resolved, Important — fixed или acknowledged в PR.
6. Final report: changed files, check results, risks, commit message — по
   CLAUDE.md §Definition of Done.
7. Memory update: новый memory-entry `project_ux_hardening_premium_pass` в
   `memory/` с итогами блока.

---

**Конец спецификации.** Это implementation-ready spec, не план реализации.
Реализация — отдельной сессией через `/plan` → `/build` → `/test` → `/review`
→ `/ship`, по sub-tasks из §11.
