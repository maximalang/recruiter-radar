# План: Lead Generation Platform для Рекрутинговых Агентств

**Версия:** 2.0  
**Обновлено:** 2026-05-26  
**Фокус:** Lead Generation → Agency Clients → Revenue Growth

---

## 🎯 Переосмысление продукта

Recruiter Radar — **не** агрегатор вакансий, а **B2B lead generation platform** для рекрутинговых агентств. Мы продаем не candidate matching, а **доступ к теплым компаниям-клиентам** в момент hiring activity.

### Key Insight:
**"Когда компания нанимает 3+ человек — ей нужны рекрутинговые услуги"**

---

## 🚀 Фаза 1: Core Lead Generation Engine (1-2 недели)

### Задача 1.1: Lead Discovery System
**Цель:** Находить компании, которые активно нанимают

**Target Companies:**
- **Size**: 50-500 employees (идеальный бюджет)
- **Signals**: 3+ вакансий, разные отделы, non-tech roles
- **Freshness**: <7 дней с момента первой вакансии
- **Evidence**: Career page, HR contacts, clear org structure

**Implementation:**
- Улучшить HH parser для detection hiring patterns
- Добавить career pages parsing для direct evidence
- Implement signal aggregation across sources
- Real-time lead notifications

**Приёмка:**
- 50+ qualified leads per day
- 80%+ ICP match rate
- <2 hour freshness for A/B leads

### Задача 1.2: Lead Scoring for Agencies
**Цель:** Score leads based on agency acquisition potential

**Scoring Factors:**
1. **ICP Match** (40%)
   - Industry alignment with agency specialization
   - Company size preferences
   - Geographic fit
   - Historical conversion data

2. **Hiring Intensity** (30%)
   - Number of open positions (>3 = high signal)
   - Role diversity (HR, Sales, Tech = high value)
   - Salary levels (premium = budget available)
   - Posting frequency (burst = urgent need)

3. **Market Fit** (20%)
   - Industry growth indicators
   - Expansion signals
   - Competitive intelligence
   - Market position

4. **Contact Quality** (10%)
   - Public HR contact info
   - Career page quality
   - Response history
   - Multiple contact paths

**Приёмка:**
- Score correlates with conversion rate
- 70%+ leads are actionable
- Clear next action for each lead

### Задача 1.3: Agency Profile System
**Цель:** Персонализация лидов под каждое агентство

**Features:**
- ICP configuration (industries, sizes, locations)
- Specialization tracking (tech, executive, bulk)
- Historical performance tracking
- Competitive analysis

**Implementation:**
- Agency onboarding questionnaire
- Dynamic ICP updates
- Performance-based lead weighting
- A/B testing for lead quality

**Приёмка:**
- Individual lead scoring per agency
- 30% improvement in relevance
- Easy ICP configuration

---

## 📈 Фаза 2: Lead Management & Outreach (2-3 недели)

### Задача 2.1: Lead Pipeline CRM
**Цель:** Full lead management workflow for agencies

**Pipeline:**
```
New → Qualified → Contacted → Meeting → Proposal → Client → Lost
  ↓         ↓         ↓         ↓
 Nurture   Requalify  Follow-up  Archive
```

**Features:**
- Drag-and-drop pipeline management
- Lead tagging and categorization
- Interaction history
- Task reminders
- Email/Telegram integration
- Document storage (proposals, contracts)

**Implementation:**
- Custom CRM-lite implementation
- API integration for popular CRMs
- Export capabilities
- Team collaboration features

**Приёмка:**
- 80% agencies can use as primary CRM
- Seamless workflow from lead to client
- Mobile-responsive interface

### Задача 2.2: Outreach Automation
**Цель:** Automated yet personalized outreach

**Smart Features:**
- Template personalization based on company data
- Timing optimization (best contact times)
- Multi-channel (email + Telegram)
- A/B testing for templates
- Performance tracking

**Personalization Elements:**
- Company-specific pain points
- Industry-relevant messaging
- Competitive context
- Social proof (similar clients)

**Implementation:**
- Template builder with variables
- Scheduling system
- Delivery monitoring
- Response tracking

**Приёмка:**
- 30%+ response rate
- Personalized at scale
- Reduced manual effort

### Задача 2.3: Analytics Dashboard
**Цель:** Show ROI and performance metrics

**Key Metrics:**
- Lead-to-client conversion rate
- Average deal size
- Sales cycle length
- Cost per acquisition
- Channel effectiveness
- ROI by source

**Visualizations:**
- Sales pipeline funnels
- Lead quality trends
- Revenue forecasting
- Agency benchmarking

**Implementation:**
- Real-time dashboard
- Custom reports
- Export to Excel/Google Sheets
- API for BI tools

**Приёмка:**
- Clear ROI demonstration
- Actionable insights
- Executive-ready reports

---

## 🎯 Фаза 3: Lead Quality & Intelligence (2 недели)

### Задача 3.1: Advanced Lead Scoring
**Цель:** ML-powered lead prediction

**Features:**
- Historical learning from conversions
- Market condition adjustments
- Competitive impact scoring
- Seasonal trend analysis
- Lead decay modeling

**Implementation:**
- Simple ML model (Random Forest)
- Feedback loop from conversions
- A/B testing scoring models
- Continuous improvement

**Приёмка:**
- 80% accuracy in predicting conversions
- 20% improvement in lead quality
- Adaptive scoring system

### Задача 3.2: Market Intelligence
**Цель:** Provide competitive advantage to agencies

**Features:**
- Industry hiring trends
- Salary benchmarks
- Talent availability
- Market saturation analysis
- Competitor hiring patterns

**Delivery:**
- Weekly reports
- Custom alerts
- Executive summaries
- Actionable insights

**Implementation:**
- Data aggregation from multiple sources
- Trend analysis
- Competitive tracking
- Automated reporting

**Приёмка:**
- Become go-to market intelligence source
- Differentiation for agencies
- Thought leadership content

---

## 💼 Фаза 4: Enterprise Scale (3-4 недели)

### Задача 4.1: Multi-Agency Platform
**Цель:** Support multiple agencies with data separation

**Features:**
- Data isolation between agencies
- Shared market intelligence (anonymized)
- Competitive protection (no overlap)
- Admin dashboard
- Usage analytics

**Implementation:**
- Multi-tenant architecture
- Role-based access control
- Data encryption
- Compliance measures

**Приёмка:**
- Multiple agencies on same platform
- No data leakage
- Scalable performance

### Задача 4.2: Advanced Features
**Features:**
- Lead marketplace (companies → agencies)
- White-label solution
- Advanced integrations
- Custom reporting
- Dedicated support

**Implementation:**
- API-first architecture
- Plugin system
- Custom development workflow
- Enterprise SLAs

**Приёмка:**
- Enterprise-ready platform
- Customization capabilities
- High scalability

---

## 📊 Lead Generation Success Metrics

### Business Metrics
| Метрика | Целевое значение | Значение для бизнеса |
|---------|------------------|---------------------|
| **Pipeline** | Leads/month/agency | 50-100 |
| | New companies/week | 20-30 |
| | Lead freshness | <2 hours |
| **Conversion** | Lead-to-client | 15-20% |
| | Sales cycle | 30-60 days |
| | Response rate | 30%+ |
| **Revenue** | Avg deal size | $5k-20k |
| | Monthly revenue/agency | $10k-50k |
| | ROI | 300%+ |

### Quality Metrics
| Метрика | Целевое значение |
|---------|------------------|
| Lead relevance | 80%+ |
| ICP match rate | 90%+ |
| Deduplication | <1% |
| Delivery success | 95%+ |
| Data freshness | <24 hours |

### Platform Metrics
| Метрика | Целевое значение |
|---------|------------------|
| Uptime | 99.5%+ |
| API response time | <500ms |
| User satisfaction | 4.5+/5 |
| Churn rate | <5%/month |

---

## 💡 Key Differentiators

### Unlike Traditional Job Boards
1. **We sell to agencies, not candidates**
2. **Focus on client acquisition, not hiring**
3. **Evidence-based leads, not job postings**
4. **B2B SaaS model, not advertising**

### Unlike Traditional CRMs
1. **Specialized for lead generation**
2. **Built-in market intelligence**
3. **Automated lead discovery**
4. **Industry-specific scoring**

### Unique Value Proposition
"Мы превращаем hiring signals в готовых клиентов для рекрутинговых агентств"

---

## 🎯 Quick Wins (<1 неделя)

1. **Agency ICP Questionnaire** - быстрая настройка профиля
2. **Lead Scoring MVP** - базовая система оценки
3. **Outreach Templates** - готовые шаблоны первого контакта
4. **Basic Dashboard** - метрики и конверсии
5. **Lead Notifications** - real-time alerts о новых лидов

---

## 🛠️ Implementation Priority

1. **Now**: Lead discovery + basic scoring
2. **Next week**: Agency profiles + pipeline
3. **Month 2**: Outreach automation + analytics
4. **Month 3**: ML scoring + enterprise features

---

Этот план фокусируется на создании **real lead generation platform** для рекрутинговых агентств, что принципиально отличается от существующих решений на рынке.