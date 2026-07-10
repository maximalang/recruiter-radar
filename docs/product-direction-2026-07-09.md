---
title: Product Direction Overhaul — 2026-07-09
scope: brutal audit + architecture + UI redesign + pricing
status: draft — requires user approval before implementation
---

# Пересборка продукта в правильную сторону

Дата: 2026-07-09
Контекст: Recruiter Radar — Russia-first evidence-first radar для recruitment agencies

---

## БЛОК 1 — Коррекция product direction

### A. Что сейчас выглядит слабо / «не под РФ» / как внутренняя админка

**1. Дашборд — это системный мониторинг, не рабочий инструмент агентства**

`DashboardOverview` показывает: «Всего источников: 12», «Общее здоровье: 85%», «Активные источники: 83%», «Активные алерты: 2». Это метрики DevOps/инженера, не рекрутера. Агентство не хочет видеть «здоровье системы» — оно хочет видеть «сколько компаний можно написать сегодня» и «что изменилось с вчера».

Блок «Источники» с прогресс-барами per source — техническая телеметрия, не ценность для клиента. Блок «Алерты» — инфраструктурные проблемы (HH 403, SuperJob key), которые интересны только нам, операторам.

**Что делать:** Дашборд = «Сегодняшний радар» наверху (уже есть, хорошо), затем «Качество доказательств» (gate A/B/C/D breakdown), затем «Аналитика по источникам» (только agency-facing: сколько лидов, какое покрытие, конверсия). Убрать «Общее здоровье», «Активные алерты», «Всего источников» — это внутренняя телеметрия, не для клиента.

**2. Навигация — плоский top-bar без идентичности**

`TopNav`: 48px высота, белый фон, 4 ссылки (Дашборд, Лиды, Ревью, Профиль). Это generic SaaS admin nav. Нет бренда, нет Russia-first идентичности, нет ощущения premium-инструмента. Ссылки на 0.82rem — мелко, неуверенно.

**Что делать:** Sidebar навигация с brand identity (TargetIcon + «Recruiter Radar» крупнее), или расширенный top-nav с brand zone слева. Добавить визуальный акцент на «Радар» как основное действие.

**3. Цветовая палитра — generic corporate gray**

Дизайн-токены: `--c-bg-page: #f8fafc`, `--c-border: rgba(15,23,42,0.08)`, `--c-brand: #1d4ed8`. Это Tailwind slate/blue — универсально, но не memorable. Нет визуальной связи с Russia-first позиционированием. Нет premium-ощущения (нет gradient accents, нет depth, нет character).

**Что делать:** Расширить палитру: brand gradient (deep blue → indigo для premium), success green для gate A/B, warm amber для urgency. Добавить subtle gradient accents на hero-элементы (дашборд-метрики, lead cards). Не менять базовые токены — расширять.

**4. Lead card — information-dense но нет visual hierarchy**

`LeadCard` в `leads/page.tsx`: rail (color-coded left border), head (org name + chips), body (why-fit, why-now), footer (urgency, freshness, contact, location). Информационно хорошо, но визуально — всё одного размера, нет «hero moment». Орг-название не выделяется. Why-now и why-fit — одинаковый шрифт, одинаковый вес.

**Что делать:** Сделать org-name крупнее жирным, why-now в отдельном accent-блоке (brand-tinted background), chips меньше и компактнее. Добавить subtle hover elevation.

**5. Лендинг — хороший, но внутренний продукт не наследует его язык**

Лендинг говорит: «3 минуты — и видно, кому писать сегодня», «Живой hiring-proof», «Без регистрации». Внутренний продукт: «Всего источников: 12», «Общее здоровье: 85%». Язык и ценности не совпадают.

**Что делать:** Внутренний продукт должен говорить на том же языке: «Компании, которым стоит написать сегодня», «Доказательства по каждому сигналу», «Готовый угол контакта».

### B. Где в текущем продукте/коде заложена ручная модель

**Ключевой факт: ручного ввода компаний/организаций в коде НЕТ.**

Проверены все routes, forms, и data flow:
- `ClientProfile` (30+ полей) — только профиль агентства (специализации, роли, регионы, delivery preferences)
- `Org` — 5 полей (id, name, domain, website_url, timestamps), ВСЁ auto-populated через ingestion
- `ProfileForm` — только ICP-поля (industries, roles, companySizes, keywords, contactPolicy, hiringMode)
- `DeliveryForm` — только delivery preferences (Telegram, email, web-push)
- Onboarding wizard — pre-filled from checkout order payload, НЕ ручной ввод компаний

**Где есть «ручная модель» — это НЕ код, а product perception:**

1. **Dashboard «Источники» блок** — показывает источники как «что система мониторит», а не «что система нашла для вас». Создаёт ощущение что пользователь должен «настраивать источники».

2. **Профиль с 10+ полями** —虽然合理но для ICP, но выглядит как «много настроек». На деле большинство полей are optional with sensible defaults.

3. **Onboarding wizard (916 строк)** — 4 шага (confirm-profile → telegram → preview → complete). Шаг «confirm-profile» pre-filled, но выглядит как «введите данные». Должен быть: «Мы нашли компании по вашему профилю — вот preview».

4. **Нет «system found N companies for you» moment** — после активации профиля нет clear feedback: «Система нашла X компаний, Y из них с прямым hiring-proof». Пользователь видит пустой дашборд или «Пока нет компаний для контакта».

### C. Каноническая product model

```
ПОЛЬЗОВАТЕЛЬ ВВОДИТ ТОЛЬКО:
├── Профиль агентства (ICP)
│   ├── Специализации / индустрии
│   ├── Роли / функции
│   ├── Регионы (city/region)
│   ├── Размеры компаний
│   ├── Keywords (optional boost)
│   ├── Hiring mode (specialist/executive/volume)
│   ├── Contact preferences (policy, exclusions)
│   └── Delivery preferences (Telegram, email, web-push, time)
│
СИСТЕМА НАХОДИТ САМА:
├── Компании (org discovery)
│   ├── HH/Vacancy aggregator signals
│   ├── Career pages (direct hiring proof)
│   ├── Rabota Rossii / Trudvsem
│   ├── EGRUL/FNS (INN, legal data)
│   ├── Habr Career
│   └── Future: LinkedIn, SuperJob (when healthy)
│
├── Company enrichment
│   ├── Domain / website detection
│   ├── Career page URL probing (12 paths)
│   ├── AI enrichment (Firecrawl/Crawl4AI)
│   ├── INN → DaData enrichment (future)
│   └── Cross-source entity merge (future)
│
├── Hiring signals
│   ├── Vacancy count + freshness
│   ├── Hiring burst detection
│   ├── Role diversity
│   ├── Independent confirmation (multi-source)
│   └── Urgency cues (burst, stale, new region)
│
├── Evidence + scoring
│   ├── FIUR scoring (Fit + Intent + Urgency + Reachability)
│   ├── Confidence gates (A/B/C/D)
│   ├── Why-now explanation
│   ├── Why-fit explanation (ICP match)
│   └── Safe contact path derivation
│
└── Delivery
    ├── Daily Telegram digest
    ├── Email digest
    ├── Web-push notifications
    └── Feedback loop (buttons → suppression/reweighting)
```

**Ключевой принцип:** Пользователь настраивает «что мне нужно» (ICP). Система решает «кто подходит и почему». Пользователь действует (пишет компаниям) или корректирует (Беру/Мимо/Позже).

---

## БЛОК 2 — Архитектура auto-discovery для РФ

### Текущее состояние

6 зарегистрированных источников:
- `hh` — HH.ru API (P1, primary, daily) — **platform_aggregation** (geo-403, эксперименты остановлены)
- `superjob` — SuperJob API (P1, primary, daily) — **platform_aggregation** (здоров)
- `habr-career` — Habr Career API (P1, primary, daily) — **platform_aggregation**
- `career-pages` — Прямой краулинг корпоративных сайтов (P1, primary, daily) — **ЕДИНСТВЕННЫЙ direct_hiring_proof**
- `egrul-fns` — ЕГРЮЛ/FNS реестры (P2, secondary) — **platform_aggregation** (нет domain)
- `rabota-rossii` — Trudvsem OpenData API (P2, secondary, daily) — **platform_aggregation**

### Проблема: все РФ кроме career-pages = platform_aggregation = gate C

Career-pages — ЕДИНСТВЕННЫЙ источник direct_hiring_proof. Все остальные дают только «aggregated signal» → gate C → «требует проверки». Это значит:
- Gate A/B (авто-доставка) возможен ТОЛЬКО через career-pages
- Без career-page у компании = нет прямого hiring-proof = gate C max
- Даже если HH + Rabota Rossii + Egrul подтверждают найм = gate C (platform aggregation × 3 = всё ещё platform)

### Архитектура: 4 слоя auto-discovery

```
Layer 1: SIGNAL DISCOVERY (что компания нанимает)
├── Career page crawl (direct proof) — УЖЕ РЕАЛИЗОВАНО
│   ├── 12 probe paths (/careers, /vacancies, /jobs, /career, ...)
│   ├── Same-domain link extraction from homepage HTML
│   ├── JSON-LD vacancy extraction + HTML card fallback
│   └── Budget: CAREER_PAGES_FETCH_BUDGET_MS (90s)
│
├── Vacancy aggregator parsing — УЖЕ РЕАЛИЗОВАНО
│   ├── HH API (geo-403, stopped)
│   ├── SuperJob API (healthy)
│   ├── Rabota Rossii / Trudvsem (healthy, 12-region iteration)
│   └── Habr Career (healthy)
│
├── Corporate site signal detection — НОВОЕ
│   ├── «Мы ищем» / «Вакансии» / «Присоединяйтесь» page detection
│   ├── Job widget detection (SmartRecruiter, Greenhouse, Lever, Workable)
│   └── «Карьера» subdomain detection (career.company.ru)
│
└── Social signal aggregation — НОВОЕ
    ├── LinkedIn company page (hiring activity indicator)
    ├── Headcount growth signals (public data)
    └── News/press release hiring mentions

Layer 2: ENTITY RESOLUTION (это одна и та же компания)
├── Current: two-level (org_id groups + name-hash groups) — УЖЕ РЕАЛИЗОВАНО
├── INN-based merge — НОВОЕ (cross-source merge epic, deferred)
│   ├── EGRUL provides INN
│   ├── HH provides INN for some employers
│   └── DaData INN → domain resolution
└── Domain-based merge — НОВОЕ
    ├── Same domain across sources = same org
    └── www/non-www normalization

Layer 3: COMPANY ENRICHMENT (дополнительные данные о компании)
├── Career page URL detection — УЖЕ РЕАЛИЗОВАНО (12-path probe)
├── AI enrichment (Firecrawl/Crawl4AI) — УЖЕ РЕАЛИЗОВАНО
│   ├── Per-org quota 1/24h
│   ├── MAX_CANDIDATES_PER_RUN = 50
│   └── JSONB ai_enrichment persistence
├── Domain → company metadata — НОВОЕ
│   ├── DaData API: INN → company name, legal form, employees, okved
│   ├── Whois: domain registration date, registrar
│   └── SSL certificate: organization validation
└── Contact path derivation — УЖЕ РЕАЛИЗОВАНО (deriveContactPaths)

Layer 4: EVIDENCE SCORING (оценка качества доказательств)
├── FIUR scoring — УЖЕ РЕАЛИЗОВАНО
│   ├── Fit: ICP match (industries, roles, regions, sizes)
│   ├── Intent: vacancy count, freshness, burst, career page
│   ├── Urgency: burst, stale roles, new region
│   └── Reachability: career page, corporate site, contact paths
├── Confidence gates A/B/C/D — УЖЕ РЕАЛИЗОВАНО
├── Evidence quality tagging — УЖЕ РЕАЛИЗОВАНО
│   ├── direct_hiring_proof (career-pages only)
│   └── platform_aggregation (all others)
└── Cross-source corroboration boost — НОВОЕ
    ├── 2+ independent sources confirming hiring = intent boost
    ├── Same company on HH + career page = stronger signal
    └── Currently: sources are additive, not multiplicative
```

### Приоритетные улучшения (без breaking changes)

**P0 — Усилить career-pages coverage (единственный direct proof)**
- Уже: 12 probe paths, same-domain link extraction, HTML card fallback
- Добавить: больше русских career-page паттернов (/вакансии, /работа у нас, /присоединяйся)
- Добавить: job widget detection (SmartRecruiter, Greenhouse на русских компаниях)
- Метрика: % компаний с career-page URL (цель: >30% gate A/B)

**P1 — DaData enrichment (domain + INN resolution)**
- EGRUL носит INN, но НЕ несёт domain → нет career-page crawl → Reachability capped
- DaData API: INN → domain + employees count + OKVED
- Это закроет «egrul cannot backfill domain» проблему
- Добавит real employee count для Fit scoring (companySizes filter)

**P2 — Cross-source entity merge**
- Сейчас: entity resolution scopes to WHERE source=$1 → one INN → N org_id
- Нужно: canonical org identity + safe ref/signals re-linking
- Это epic, не quick fix — отдельная сессия

**P3 — Social signal aggregation**
- LinkedIn company page hiring activity
- Headcount growth (public data)
- News mentions
- Низкий приоритет: основные сигналы уже покрыты

---

## БЛОК 3 — Premium UI направление

### Визуальная стратегия

**Текущее состояние:** Generic corporate SaaS (slate/blue, flat cards, 48px top-nav)
**Целевое состояние:** Premium B2B-инструмент для российских рекрутинговых агентств

Ключевые принципы:
1. **Agency-first hierarchy:** «Компании для контакта» > «Доказательства» > «Аналитика» > «Система»
2. **Evidence-first visual language:** Gate A/B = зелёный/синий (уверенность), Gate C = amber (осторожность), Gate D = gray (контекст)
3. **Premium depth:** Subtle gradients, layered shadows, glassmorphism на hero-элементах
4. **Russia-first identity:** Кириллица first, русские паттерны UI, premium без western SaaS копирования

### Что менять (по приоритету)

**1. Dashboard redesign — agency-facing, not system-facing**
- Убрать: «Всего источников», «Общее здоровье», «Активные алерты»
- Оставить: «Сегодняшний радар» (top), «Качество доказательств» (gate breakdown), «Аналитика» (source performance)
- Добавить: «Сводка дня» hero-блок (N компаний, M с прямым proof, K готовы к контакту)

**2. Navigation — brand identity**
- Sidebar или расширенный top-nav с brand zone
- TargetIcon крупнее + «Recruiter Radar» с tagline

**3. Lead card premium treatment**
- Org-name крупнее жирным
- Why-now в accent-блоке (brand-tinted)
- Chips компактнее

### Реализация: Dashboard Overview → Daily Summary hero

Самый безопасный и high-leverage change — заменить `DashboardOverview` (system metrics) на `DashboardDailySummary` (agency-facing hero). Это:
- Не меняет data flow (все данные уже доступны через safeDashboardFetch)
- Не ломает существующие компоненты
- Сразу меняет ощущение продукта
- Затрагивает самый первый экран, который видит пользователь

Начинаю реализацию.

---

## БЛОК 4 — Pricing 5k–50k ₽/мес

### Рыночный контекст

Российский рынок HR-tech:
- HH.ru: 3k–15k ₽/мес за доступ к базе
- Zoho/HubSpot CRM: 3k–10k ₽/мес (нет HR-specific)
- Custom ATS: 20k–100k ₽/мес (для агентств 10+ рекрутеров)
- Recruiter Radar: **не ATS, не CRM** — это intelligence radar, premium data product

Целевой клиент: рекрутинговое агентство 2–20 человек, специализация на IT/tech/finance, работает с российскими компаниями. Budget для инструментов: 5k–50k ₽/мес на команду.

### Тарифы

#### Стартовый — 4 900 ₽/мес
Для: solo-рекрутер или микро-агентство (1–2 человека), тестирование продукта
- 1 профиль агентства (ICP)
- Ежедневный Telegram-дайджест (до 10 лидов/день)
- До 30 компаний в радаре (top-30 по FIUR score)
- Gate A/B автоматическая доставка
- Gate C — на проверке
- Email-дайджест (1 раз/день)
- Базовые feedback-кнопки (Беру/Мимо/Позже)
- Основные источники (HH, career-pages, rabota-rossii)
- Нет AI enrichment
- Нет приоритетного краулинга
- Поддержка: email, 48ч

#### Агентство — 14 900 ₽/мес
Для: агентство 3–8 рекрутеров, стабильный поток клиентов
- 3 профиля агентства (разные ниши/команды)
- Ежедневный Telegram-дайджест (до 30 лидов/день)
- До 100 компаний в радаре
- Все gate A/B/C с review queue
- AI enrichment (Firecrawl/Crawl4AI) — до 50 org/день
- Приоритетный краулинг career-pages (12 paths + job widget detection)
- CRM-identifier enriched CSV export
- Single-lead CSV (для передачи рекрутеру)
- Все источники (HH, SuperJob, career-pages, rabota-rossii, habr, egrul)
- Настройка delivery time (утро/день/вечер)
- Web-push уведомления
- Поддержка: email + Telegram, 24ч

#### Команда — 29 900 ₽/мес
Для: агентство 8–20 рекрутеров, несколько направлений, enterprise-клиенты
- 10 профилей агентства
- Ежедневный Telegram-дайджест (до 100 лидов/день)
- Без ограничений на компании в радаре
- Всё из «Агентство» +
- Multi-lead CSV (bulk export с CRM-полями)
- API-доступ (LEAD_API_KEY, INGEST_API_KEY)
- Webhook-интеграция (n8n, custom CRM)
- Приоритетная поддержка: email + Telegram + call, 4ч
- Ежемесячная аналитика (конверсия gate → contact → client)
- White-label опция (кастомный brand в Telegram-дайджесте)

### Включение/выключение по тарифу

| Функция | Стартовый | Агентство | Команда |
|---|---|---|---|
| Профили ICP | 1 | 3 | 10 |
| Лидов/день | 10 | 30 | 100 |
| Компании в радаре | 30 | 100 | ∞ |
| Gate A/B автодоставка | ✓ | ✓ | ✓ |
| Gate C review | ✓ | ✓ | ✓ |
| AI enrichment | ✗ | 50/день | ∞ |
| Career-pages priority | ✗ | ✓ | ✓ |
| CRM-identifier CSV | ✗ | ✓ | ✓ |
| Multi-lead CSV | ✗ | ✗ | ✓ |
| API access | ✗ | ✗ | ✓ |
| Webhook | ✗ | ✗ | ✓ |
| Delivery time setting | ✗ | ✓ | ✓ |
| Web-push | ✗ | ✓ | ✓ |
| White-label | ✗ | ✗ | ✓ |
| Поддержка | 48ч email | 24ч email+TG | 4ч all channels |

### Pricing page copy (русский)

**Стартовый — 4 900 ₽/мес**
Начните с радара. 1 профиль, до 10 лидов в день, все доказательства — без AI-обогащения.
Для: solo-рекрутер или тестирование продукта.

**Агентство — 14 900 ₽/мес**
Полный радар для агентства. 3 профиля, AI-обогащение, приоритетный краулинг, CRM-экспорт.
Для: агентство 3–8 человек, стабильный поток.

**Команда — 29 900 ₽/мес**
Без ограничений. API, webhooks, white-label, priority support.
Для: агентство 8–20 человек, enterprise-клиенты.

---

## БЛОК 5 — Следующие задачи

### Приоритет 1 — UI/UX (БЛОК 3, immediately)
1. **Dashboard Overview → Daily Summary** — заменить system metrics на agency-facing hero (ВЫПОЛНЯЕТСЯ)
2. **Dashboard CSS premium treatment** — gradient accents, layered shadows, hero-блок
3. **Lead card visual hierarchy** — org-name крупнее, why-now accent-блок
4. **Navigation brand identity** — sidebar или расширенный top-nav

### Приоритет 2 — Auto-discovery (БЛОК 2, P0-P1)
5. **Career-pages RU patterns** — добавить /вакансии, /работа у нас, /присоединяйся
6. **Career-pages job widget detection** — SmartRecruiter, Greenhouse
7. **DaData enrichment** — INN → domain + employees (P1)

### Приоритет 3 — Product polish
8. **Onboarding "system found N companies" moment** — preview after profile activation
9. **Dashboard "Качество доказательств" section** — gate A/B/C/D breakdown
10. **Pricing page** — 3 тарифа с копирайтингом

### Приоритет 4 — Architecture (P2-P3, deferred)
11. **Cross-source entity merge** — canonical org identity
12. **Social signal aggregation** — LinkedIn, headcount, news
13. **API documentation** — для командного тарифа

---

## Файлы для изменения (БЛОК 3, задача 1)

- `apps/web/app/dashboard/dashboard-overview.tsx` — полная замена контента
- `apps/web/app/dashboard/dashboard.module.css` — стили для нового hero-блока
- `apps/web/app/dashboard/page.tsx` — обновить порядок секций
