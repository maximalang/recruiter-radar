# План: Lead Generation Platform для Рекрутинговых Агентств

**Версия:** 3.0  
**Дата:** 2026-05-26  
**Статус:** Новая концепция - Lead Generation Platform  
**Фокус:** Полноценная платформа для генерации лидов для рекрутинговых агентств

---

## 🎯 Введение

Recruiter Radar превращается из агрегатора вакансий в **премиум B2B платформу генерации лидов** для рекрутинговых агентств. Продукт находит компании-клиенты (не кандидатов!), которым стоит предложить рекрутинговые услуги прямо сейчас.

### Ключевое отличие:
- **Job boards** → кандидаты на вакансии
- **Recruiter Radar** → компании-клиенты для агентств

---

## 🔍 Dependency Graph

### Основные компоненты:
1. **Lead Discovery Engine** → Sources (HH, Career Pages, Rabota Rossii)
2. **Lead Scoring System** → FIUR model (repositioned for B2B)
3. **Agency Profile System** → ICP matching and personalization
4. **Lead Pipeline CRM** → Sales workflow management
5. **Outreach Automation** → Multi-channel client acquisition
6. **Analytics Dashboard** → ROI and performance tracking

### Поток данных:
```
Sources → Evidence → Scoring → Agency Filtering → Lead Delivery → 
Feedback Scoring → Pipeline Management → Analytics → Optimization
```

---

## 🏗️ Vertical Slices (Complete Paths)

### 1. Core Lead Generation Engine (2-3 недели)

#### Path: Signal-to-Lead Workflow
**Цель:** Создать полноценный pipeline от сигнала до лидов для агентств

**Компоненты:**
- [ ] Улучшенный HH parser с detection hiring patterns
- [ ] Career pages parsing с multiple contact paths
- [ ] Агрегация сигналов из источников
- [ ] FIUR scoring для client acquisition
- [ ] Lead enrichment и evidence building
- [ ] Quality gates и confidence classification

**Acceptance Criteria:**
- [ ] 50+ квалифицированных лидов в день
- [ ] 80%+ match с агентским ICP
- [ ] <2 часа freshness для A/B лидов
- [ ] Explainable scoring breakdown

**Verification Steps:**
1. Запустить `npm run lead:generate` и проверить вывод
2. Проверить `lead_candidates` таблицу на качество лидов
3. Проверить scoring breakdown для агентских профилей
4. Протестировать edge cases (дубли, низкокачественные сигналы)

---

#### Path: Agency Profile & ICP System
**Цель:** Персонализация лидов под каждое агентство

**Компоненты:**
- [ ] Onboarding questionnaire для агентств
- [ ] ICP configuration (industries, sizes, locations)
- [ ] Historical performance tracking
- [ ] Dynamic lead weighting based on feedback
- [ ] A/B testing framework

**Acceptance Criteria:**
- [ ] Individual scoring per agency
- [ ] 30% improvement в relevance
- [ ] <5 min setup time
- [ ] Performance-based optimization

**Verification Steps:**
1. Создать тестовый agency profile
2. Проверить scoring для разных профилей
3. Тестировать feedback loop
4. Проверить performance metrics

---

### 2. Lead Management & Outreach (3-4 недели)

#### Path: Lead Pipeline CRM
**Цель:** Full sales workflow для агентств

**Компоненты:**
- [ ] Drag-and-drop pipeline interface
- [ ] Lead status tracking (New → Qualified → Contacted → Meeting → Proposal → Client)
- [ ] Tagging and categorization system
- [ ] Interaction history
- [ ] Task management
- [ ] Email/Telegram integration

**Acceptance Criteria:**
- [ ] 80% агентств могут использовать как primary CRM
- [ ] Seamless workflow от lead до client
- [ ] Mobile-responsive interface
- [ ] Data export capabilities

**Verification Steps:**
1. Протестировать full pipeline workflow
2. Проверить integration с email/Telegram
3. Тестировать team collaboration features
4. Проверить performance при большом volume

---

#### Path: Outreach Automation
**Цель:** Автоматизированный yet персонализованный outreach

**Компоненты:**
- [ ] Template system с персонализацией
- [ ] Smart scheduling (best contact times)
- [ ] Multi-channel delivery (email + Telegram)
- [ ] A/B testing for templates
- [ ] Performance tracking

**Acceptance Criteria:**
- [ ] 30%+ response rate
- [ ] 80%+ deliverability
- [ ] Personalized at scale
- [ ] 50% reduction в manual effort

**Verification Steps:**
1. Тестировать template personalization
2. Проверить timing optimization
3. Измерить response rates
4. Тестировать fallback mechanisms

---

### 3. Lead Quality & Intelligence (2-3 недели)

#### Path: Advanced Lead Scoring
**Цель:** ML-powered prediction и continuous improvement

**Компоненты:**
- [ ] Historical learning from conversions
- [ ] Market condition adjustments
- [ ] Competitive impact scoring
- [ ] Seasonal trend analysis
- [ ] Predictive features

**Acceptance Criteria:**
- [ ] 80% accuracy в predicting conversions
- [ ] 20% improvement в lead quality
- [ ] Adaptive scoring system

**Verification Steps:**
1. A/B test scoring models
2. Track correlation с conversion rates
3. Monitor model decay
4. Test against market changes

---

#### Path: Market Intelligence
**Цель:** Competitive advantage для агентств

**Компоненты:**
- [ ] Industry hiring trends
- [ ] Salary benchmarks
- [ ] Talent availability
- [ ] Competitive monitoring
- [ ] Actionable insights delivery

**Acceptance Criteria:**
- [ ] Become go-to market intelligence source
- [ ] Differentiation for agencies
- [ ] High-value insights

**Verification Steps:**
1. Проверить quality insights
2. Измерить adoption rate
3. Test against known market trends
4. Проверить actionable nature

---

### 4. Enterprise Scale (3-4 недели)

#### Path: Multi-Agency Platform
**Цель:** Enterprise-ready multi-tenant architecture

**Компоненты:**
- [ ] Multi-tenant design with data isolation
- [ ] Security & compliance measures
- [ ] Shared market intelligence (anonymized)
- [ ] Competitive protection
- [ ] Admin dashboard
- [ ] Usage analytics

**Acceptance Criteria:**
- [ ] Multiple agencies on same platform
- [ ] No data leakage
- [ ] Enterprise-grade security
- [ ] Scalable performance

**Verification Steps:**
1. Тестировать data isolation
2. Проверить security measures
3. Тестировать performance under load
4. Проверить compliance requirements

---

#### Path: Marketplace & Integrations
**Цель:** Connect companies with right agencies

**Компоненты:**
- [ ] Agency marketplace
- [ ] Company-to-agency matching
- [ ] RFP system
- [ ] CRM integrations
- [ ] Custom reporting
- [ ] API access

**Acceptance Criteria:**
- [ ] Quality matches
- [ ] Reduced sales cycle
- [ ] Enterprise-ready platform

**Verification Steps:**
1. Test matching algorithm
2. Measure conversion rates
3. Test integrations
4. Validate API endpoints

---

## 🎯 Checkpoints & Milestones

### Milestone 1: MVP Lead Generation (End of Week 2)
- [ ] Core lead generation engine working
- [ ] Agency profiles with ICP matching
- [ ] Basic lead pipeline
- [ ] Telegram digest delivery

### Milestone 2: Sales Workflow (End of Week 5)
- [ ] Complete pipeline CRM
- [ ] Outreach automation
- [ ] Basic analytics
- [ ] Agency onboarding flow

### Milestone 3: Advanced Features (End of Week 8)
- [ ] ML-powered scoring
- [ ] Market intelligence
- [ ] Multi-agency support
- [ ] Enterprise features

### Milestone 4: Marketplace (End of Week 12)
- [ ] Agency marketplace
- [ ] Advanced integrations
- [ ] Premium support
- [ ] Full platform ready

---

## 📊 Success Metrics

### Business Metrics
| Метрика | Целевое значение |
|---------|------------------|
| **Pipeline** | 50-100 leads/month/agency |
| | Lead freshness <2 hours |
| **Conversion** | Lead-to-client 15-20% |
| | Sales cycle 30-60 days |
| **Revenue** | Avg deal size $5k-20k |
| | Monthly revenue/agency $10k-50k |
| | ROI 300%+ |

### Quality Metrics
| Метрика | Целевое значение |
|---------|------------------|
| Lead relevance | 80%+ |
| ICP match rate | 90%+ |
| Deduplication | <1% |
| Data freshness | <24 hours |

### Platform Metrics
| Метрика | Целевое значение |
|---------|------------------|
| Uptime | 99.5%+ |
| API response time | <500ms |
| User satisfaction | 4.5+/5 |
| Churn rate | <5%/month |

---

## 🔧 Technical Requirements

### Lead Schema
```typescript
interface AgencyLead {
  id: string;
  company: Company;
  status: 'new' | 'qualified' | 'contacted' | 'meeting' | 'proposal' | 'client' | 'lost';
  score: number;
  confidence: 'high' | 'medium' | 'low';
  sources: HiringSource[];
  nextAction: LeadAction;
  assignedTo: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Agency Workflow
```
Daily Radar → Review Leads → Prioritize → Outreach → 
Track Responses → Schedule Meetings → Send Proposal → 
Close Deal → Feedback → Improve Scoring
```

---

## 💡 Quick Wins (First Week)

1. **Agency ICP Questionnaire** - быстрая настройка профиля
2. **Lead Scoring MVP** - базовая система оценки
3. **Outreach Templates** - готовые шаблоны первого контакта
4. **Basic Dashboard** - метрики и конверсии
5. **Lead Notifications** - real-time alerts о новых лидов

---

## 🚀 Implementation Priority

1. **Week 1-2**: Core lead generation engine
2. **Week 3-5**: Lead pipeline & outreach automation  
3. **Week 6-8**: Advanced scoring & analytics
4. **Week 9-12**: Enterprise features & marketplace

---

## 🎯 Key Success Indicators

1. **Agencies generate pipeline** - 50+ leads/month
2. **Conversion to clients** - 15-20% of leads become clients
3. **Revenue impact** - $10k-50k/month per agency
4. **Product stickiness** - 80% monthly retention
5. **Word of mouth** - 30%+ from referrals

---

Этот план создает полноценную **lead generation platform** для рекрутинговых агентств, превращая hiring signals в revenue-generating opportunities. Каждый компонент направлен на создание ценности для агентств и обеспечение измеримого ROI.