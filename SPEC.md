# Спецификация: Recruiter Radar — Lead Generation для Рекрутинговых Агентств

**Версия:** 4.0  
**Обновлено:** 2026-05-26  
**Статус:** MVP в работе — lead generation system для агентств

---

## 1. Objective

Recruiter Radar — **premium B2B lead generation platform** для рекрутинговых агентств.

**Что мы строим:** ежедневный радар, который находит **компании-клиенты** (не кандидатов!), которым агентству стоит предложить свои услуги прямо сейчас. Каждый лид — это теплый контакт с компанией, активно нанимающей сотрудников.

**Что мы НЕ строим:** ATS, CRM, candidate sourcing, job parser, mass outreach tool.

**Целевой пользователь:** российское рекрутинговое агентство (1–30 человек), которое хочет систематизировать поиск новых клиентов и увеличить pipeline за счет hiring intelligence.

**Каждая рекомендация лида обязана отвечать на 7 вопросов:**
1. Кто компания? (изучение клиента)
2. Что изменилось? (trigger для outreach)
3. Почему это важно сейчас? (urgency)
4. Почему это подходит профилю агентства? (ICP match)
5. Какие доказательства поддерживают сигнал? (evidence)
6. Какой безопасный лавфул-путь контакта? (reachability)
7. Что сделать следующим шагом? (clear call-to-action)

**Продуктовый цикл:**
```
Landing → demo → pilot activation → agency profile → 
daily radar → lead review → outreach → 
feedback → lead scoring → better future leads
```

---

## 2. Lead Generation Model

### Target Companies Ideal Profile
- **Size**: 50-500 employees (оптимальный бюджет на услуги)
- **Industry**: IT/FinTech/E-commerce/Manufacturing (high hiring needs)
- **Hiring Signals**: 
  - 3+ открытых вакансий (сигнал роста)
  - Вакансии в разных отделах (широка потребность)
  - Non-tech roles (HR, Sales, Accounting - больше рекрутмент需求)
  - Fresh postings (<7 дней)

### Lead Quality Gates
| Gate | Критерии | Действие |
|------|----------|----------|
| **A** | Multiple hiring signals, direct HR contact, high budget | Автоматическая продажа |
| **B** | Clear expansion pattern, company website with careers | Теплый лид, персонализация |
| **C** | Indirect signals, need verification | Требует additional research |
| **D** | Only one vacancy, no clear contact | Не является лидом, контекст |

### Monetization
- **Pilot**: Бесплатный试用 с ограниченными лидами
- **Pro**: $X/месяц за неограниченный radar + advanced analytics
- **Enterprise**: Custom pricing, API access, dedicated support

---

## 3. Commands

### Development
```bash
npm install
docker compose up -d                        # Postgres + n8n
npm run dev                                 # Next.js на http://localhost:3000
```

### Quality Checks
```bash
npm run web:check                           # tsc --noEmit
npm run web:validate                        # check + build
npm run --workspace=@recruiter-radar/web test
npm run web:build                           # next build
```

### Lead Generation Pipeline
```bash
npm run source:list                         # реестр sources + tier + status
npm run source:pipeline                     # pipeline для всех активных sources
npm run lead:generate                       # основной генерация лидов
npm run lead:quality                       # проверка качества лидов
npm run analytics:performance               # метрики по лидам и конверсиям
```

### Agency Management
```bash
npm run agency:profile                      # настройка профиля агентства
npm run outreach:templates                  # шаблоны для outreach
npm run pipeline:track                      # отслеживание воронки продаж
npm run reporting:roi                       # ROI отчет для агентств
```

### Verification
```bash
npm run verify:smoke                        # composite chain
npm run verify:lead:quality                 # проверка качества лидов
npm run verify:lead:conversion               # метрики конверсии
npm run verify:agency:performance            # performance агентств
npm run verify:lead:duplicates              # проверка дублей лидов
```

---

## 4. Project Structure

```
apps/web/                       # Next.js приложение (frontend + API + бизнес-логика)
├── app/                        # App Router
│   ├── actions.ts              # server actions
│   ├── api/                    # /api/leads, /api/outreach, /api/analytics, /api/agencies
│   ├── checkout/               # onboarding + billing
│   ├── dashboard/              # личный кабинет агентства
│   └── ui/                     # UI primitives
├── lib/                        # бизнес-логика и доменные модули
│   ├── scoring/                # Lead scoring, ICP matching, conversion prediction
│   ├── db/                     # типизированный доступ к Postgres, evidence builder
│   ├── middleware/             # rbac, validation, security
│   ├── lead-generation.ts      # основной engine генерации лидов
│   ├── outreach.ts             # email/telegram outreach automation
│   ├── analytics.ts            # performance metrics, ROI tracking
│   └── agency-profile.ts       # агентские профили и ICP
├── src/__tests__/              # Jest unit / integration тесты
└── src/test-utils/             # фикстуры и утилиты для тестов

packages/db/
├── lib/                        # shared TS-типы между web и scripts
├── migrations/                 # *.sql, нумерованные миграции
└── scripts/                    # lead generation pipeline
    ├── run-lead-gen.mjs       # единый entry point
    ├── fetch-*.mjs            # sources для lead discovery
    ├── score-*.mjs            # lead scoring engine
    ├── outreach-*.mjs         # outreach automation
    └── verify-*.mjs          # verification and metrics

docker-compose.yml              # Postgres + n8n
.github/workflows/test.yml      # CI: check + build + tests + smoke
docs/                           # архитектура, продукт, security, migration guides
tasks/                          # rolling план и todo
SPEC.md                         # этот документ — single source of truth
CLAUDE.md                       # инструкции для AI-агентов
```

---

## 5. Lead Generation Engine

### Lead Scoring System
```
Total Score = ICP Match + Hiring Intensity + Market Fit + Contact Quality
              ∈ [0, 4] - чем выше, тем лучше
```

- **ICP Match** (40%): соответствие профилю агентства
  - Industry alignment
  - Company size preference
  - Geography fit
  - Historical conversion
  
- **Hiring Intensity** (30%): насколько активно компания нанимает
  - Number of open positions
  - Variety of roles
  - Posting frequency
  - Salary levels
  
- **Market Fit** (20%): насколько компания в тренде
  - Industry growth
  - Funding rounds
  - Expansion signals
  - Competitor activity
  
- **Contact Quality** (10%): как легко достучаться
  - Public contact info
  - Career page quality
  - Social media presence
  - Response history

### Lead Status Workflow
```
New → Qualified → Contacted → Meeting → Proposal → Client → Lost
  ↓         ↓         ↓         ↓
 Nurture   Requalify  Follow-up  Archive
```

### Lead Enrichment
Each lead includes:
- Company profile with financials/employees/funding
- Contact information (HR, hiring managers)
- Competitive intelligence
- Market context
- Personalized outreach templates
- Next action recommendations

---

## 6. Code Style

TypeScript strict. Маленькие явные функции. Документация — только там, где WHY неочевиден.

```typescript
// apps/web/lib/scoring/lead-scoring.ts — образец стиля
import type { ICPProfile, Company, Lead } from '@/lib/db/types'

export interface LeadScore {
  total: number
  breakdown: {
    icpMatch: number
    hiringIntensity: number  
    marketFit: number
    contactQuality: number
  }
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  nextAction: LeadAction
}

export interface LeadAction {
  type: 'call' | 'email' | 'linkedin' | 'wait'
  contact: ContactInfo
  template: string
  timing: string
  priority: 'high' | 'medium' | 'low'
}

/**
 * Scoring system specifically designed for recruitment agencies.
 * Focuses on client acquisition, not candidate matching.
 * 
 * Key insight: Companies hiring multiple roles = best leads
 * Companies hiring HR recruiters = hottest leads
 */
export function scoreLead(company: Company, vacancies: Vacancy[], icp: ICPProfile): LeadScore {
  // Implementation...
}
```

**Соглашения:**
- TypeScript strict, без `any` без явной причины
- Имена — `PascalCase` для компонентов/типов, `camelCase` для функций
- API типы — в `lib/api-types.ts`, бизнес-логика — в `lib/business-logic-types.ts`
- Input validation через `lib/validation-schemas.ts`
- Русские строки — конкретные и premium, без ложных обещаний

---

## 7. Testing Strategy

| Уровень | Где | Что тестируем |
|---------|-----|----------------|
| Unit | `apps/web/src/__tests__/lib/**` | Каждая функция в lib/, scoring logic |
| Integration | `apps/web/src/__tests__/app/**` | API routes, middleware, lead flow |
| Agency Flow | `apps/web/src/__tests__/agency/**` | dashboard, outreach, analytics |
| Lead Quality | `packages/db/scripts/verify-lead-*.mjs` | dedupe, scoring, enrichment |

**Стандарты:**
- Тест проверяет поведение, а не реализацию
- Новая фича — с unit + integration тестами
- Lead generation pipeline — с smoke тестами
- Не мокать БД в integration-тестах
- Snapshot-тесты только для стабильного UI

**Запуск:**
```bash
npm run --workspace=@recruiter-radar/web test                     # все Jest-тесты
DATABASE_URL=... npm run verify:lead:quality                      # smoke с реальной БД
```

---

## 8. Boundaries

### Всегда делать
- TypeScript strict; никаких `any` без явной причины
- Валидировать любой external input
- Параметризованный SQL для безопасности
- Подписанные сессии (`rr_sid` через `SESSION_SECRET`)
- Перед коммитом: `npm run web:check`
- Бизнес-логика только в `apps/web/lib/**` и `packages/db/scripts/**`
- Русский UI: конкретный, premium, evidence-first
- Каждая фича — с тестами

### Спрашивать первым
- Изменения схемы БД (новые миграции)
- Новые npm-зависимости > 100KB
- Изменение API контракта (`/api/leads/*`, `/api/outreach/*`)
- Изменения в lead scoring модели
- Ценообразование и биллинг
- Изменения в воронке продаж

### Никогда
- Не коммитить `.env*`, токены, дампы
- Не читать `node_modules/`, `.next/`, `build/`
- Не экспортировать n8n workflow с credentials
- Не размещать бизнес-логику в n8n
- Не обещать "гарантированные лиды" или "100% конверсию"
- Не использовать продукт без минимального уровня accessibility
- Не делать lead generation для_candidate sourcing

---

## 9. Lead Generation Quality Standards

### Data Sources
- **HH**: Primary source (vacancies, company info)
- **Career Pages**: Direct evidence of hiring
- **Rabota Rossii**: Government hiring data
- **Company Registries**: Legal entity data
- **News/Media**: Market intelligence

### Quality Metrics
- **Lead Freshness**: <24 hours for A leads, <72 hours for B
- **Deduplication Rate**: <1% duplicate companies
- **ICP Match Rate**: >80% relevance to agency profile
- **Contact Info Availability**: >70% for A/B leads
- **Delivery Success**: >95% email/telegram delivery

### Agency Success Metrics
- **Lead-to-Client Conversion**: 15-20%
- **Average Deal Size**: $5k-20k
- **Sales Cycle**: 30-60 days
- **Monthly Pipeline**: $50k-200k per agency
- **ROI**: 300%+ (based on pilot data)

---

## 10. Future Roadmap

### Phase 1 (Now): Core Lead Generation
- [ ] Multi-source lead aggregation
- [ ] Agency ICP matching
- [ ] Lead scoring and quality gates
- [ ] Basic outreach automation

### Phase 2 (Q3 2026): Agency Features
- [ ] Multi-team support
- [ ] Advanced analytics
- [ ] Template marketplace
- [ ] Integration with existing CRM

### Phase 3 (Q4 2026): Enterprise
- [ ] White-label solution
- [ ] API for custom integrations
- [ ] Advanced competitive intelligence
- [ ] Predictive lead scoring

---

**Примечание**: Эта спецификация — single source of truth. Все изменения должны проходить review и обновление здесь.