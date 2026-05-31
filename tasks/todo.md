# TODO — Lead Generation Platform для Рекрутинговых Агентств

**Связано:** `SPEC.md` (продуктовый контракт), `tasks/plan.md` (разработка и фазы), `tasks/runbook.md` (пошаговый runbook)
**Обновлено:** 2026-05-26
**Фокус:** Полноценная платформа генерации лидов для рекрутинговых агентств

---

## 🎯 P0: Core Lead Generation Engine (дедлайн 28.05.2026)

### Задача 1.1: Lead Discovery System
- [ ] Улучшить HH parser для detection hiring patterns
  - [ ] Добавить detection companies hiring 3+ roles
  - [ ] Implement non-tech roles detection (HR, Sales, Accounting)
  - [ ] Add company size analysis (50-500 employees optimal)
  - [ ] Create hiring burst detection algorithm
- [ ] Улучшить career pages parsing
  - [ ] Extract multiple contact paths
  - [ ] Detect HR hiring (recruiter vacancies = HOT signal)
  - [ ] Parse department structure
  - [ ] Extract career page quality metrics
- [ ] Implement signal aggregation
  - [ ] Combine HH + Career Pages + Rabota Rossii signals
  - [ ] Weight evidence by source reliability
  - [ ] Create unified lead format
  - [ ] Implement lead freshness tracking
- [ ] Real-time lead notifications
  - [ ] Telegram bot for new leads
  - [ ] Email digests
  - [ ] Webhook notifications
  - [ ] Push notifications for mobile

**Acceptance Criteria:**
- [ ] 50+ qualified leads per day
- [ ] 80%+ match with agency ICP
- [ ] <2 hour freshness for A/B leads
- [ ] Signal accuracy >90%

---

### Задача 1.2: Lead Scoring for Agencies
- [ ] Implement ICP Match scoring (40%)
  - [ ] Industry alignment algorithm
  - [ ] Company size preference matching
  - [ ] Geographic fit scoring
  - [ ] Historical conversion weight
- [ ] Hiring Intensity scoring (30%)
  - [ ] Position count algorithm (>3 = high)
  - [ ] Role diversity scoring
  - [ ] Salary level analysis
  - [ ] Posting frequency detection
- [ ] Market Fit scoring (20%)
  - [ ] Industry growth indicators
  - [ ] Expansion signal detection
  - [ ] Competitive position analysis
  - [ ] Market trend integration
- [ ] Contact Quality scoring (10%)
  - [ ] Contact info availability
  - [ ] Response history scoring
  - [ ] Multiple contact paths
  - [ ] Contact method preference

**Acceptance Criteria:**
- [ ] Score correlates with conversion rate (>0.7)
- [ ] 70%+ leads are actionable
- [ ] Clear next action for each lead
- [ ] Explainable score breakdown

---

### Задача 1.3: Agency Profile System
- [ ] ICP Configuration
  - [ ] Onboarding questionnaire
  - [ ] Industry selection
  - [ ] Company size preferences
  - [ ] Geographic targeting
  - [ ] Role specialization
- [ ] Performance Tracking
  - [ ] Lead conversion tracking
  - [ ] Deal size analysis
  - [ ] Sales cycle monitoring
  - [ ] Channel effectiveness
- [ ] Dynamic Lead Weighting
  - [ ] Historical performance data
  - [ ] A/B testing framework
  - [ ] Personalization engine
  - [ ] Real-time adjustments

**Acceptance Criteria:**
- [ ] Individual lead scoring per agency
- [ ] 30% improvement in relevance
- [ ] <5 min ICP configuration
- [ ] Performance-based optimization

---

## 📈 P1: Lead Management & Outreach (29.05-11.06.2026)

### Задача 2.1: Lead Pipeline CRM
- [ ] Pipeline Implementation
  - [ ] Drag-and-drop interface
  - [ ] Status transitions tracking
  - [ ] Stage definitions
  - [ ] Conversion funnels
- [ ] Lead Management
  - [ ] Tagging system
  - [ ] Lead enrichment
  - [ ] Notes and history
  - [ ] Task assignment
- [ ] Integration Layer
  - [ ] Email integration
  - [ ] Telegram integration
  - [ ] Calendar sync
  - [ ] Document storage
- [ ] Team Features
  - [ ] User roles
  - [ ] Team dashboard
  - [ ] Collaboration tools
  - [ ] Permissions system

**Acceptance Criteria:**
- [ ] 80% agencies can use as primary CRM
- [ ] Seamless lead-to-client workflow
- [ ] Mobile-responsive
- [ ] Data export capabilities

---

### Задача 2.2: Outreach Automation
- [ ] Template System
  - [ ] Personalized template builder
  - [ ] Variable insertion (company-specific)
  - [ ] A/B testing framework
  - [ ] Performance analytics
- [ ] Smart Scheduling
  - [ ] Best contact time detection
  - [ ] Follow-up sequences
  - [ ] Priority queuing
  - [ ] Time zone handling
- [ ] Multi-Channel
  - [ ] Email automation
  - [ ] Telegram bot
  - [ ] LinkedIn integration
  - [ ] SMS capabilities
- [ ] Analytics & Tracking
  - [ ] Open/click tracking
  - [ ] Response rates
  - [ ] Conversion tracking
  - [ ] ROI calculation

**Acceptance Criteria:**
- [ ] 30%+ response rate
- [ ] 80%+ deliverability
- [ ] Personalized at scale
- [ ] Reduced manual effort by 50%

---

### Задача 2.3: Analytics Dashboard
- [ ] Core Metrics
  - [ ] Lead-to-client conversion
  - [ ] Average deal size
  - [ ] Sales cycle length
  - [ ] Cost per acquisition
- [ ] Visualizations
  - [ ] Pipeline funnels
  - [ ] Lead quality trends
  - [ ] Revenue forecasting
  - [ ] Agency benchmarking
- [ ] Reports
  - [ ] Daily/weekly/monthly reports
  - [ ] Custom report builder
  - [ ] Export to Excel/CSV
  - [ ] Automated delivery
- [ ] Insights
  - [ ] Actionable recommendations
  - [ ] Performance alerts
  - [ ] Trend analysis
  - [ ] Competitive intelligence

**Acceptance Criteria:**
- [ ] Clear ROI demonstration
- [ ] Actionable insights
- [ ] Executive-ready reports
- [ ] Real-time data

---

## 🎯 P2: Lead Quality & Intelligence (12.06-25.06.2026)

### Задача 3.1: Advanced Lead Scoring
- [ ] ML Implementation
  - [ ] Random Forest model
  - [ ] Training data collection
  - [ ] Feature engineering
  - [ ] Model validation
- [ ] Learning System
  - [ ] Feedback loop from conversions
  - [ ] A/B testing framework
  - [ ] Continuous improvement
  - [ ] Model decay detection
- [ ] Predictive Features
  - [ ] Conversion probability
  - [ ] Deal size prediction
  - [ ] Sales cycle forecasting
  - [ ] Response likelihood
- [ ] Adaptive Scoring
  - [ ] Market condition adjustments
  - [ ] Seasonal trend integration
  - [ ] Competitive impact
  - [ ] Agent-specific weights

**Acceptance Criteria:**
- [ ] 80% conversion prediction accuracy
- [ ] 20% improvement in lead quality
- [ ] Adaptive to market changes
- [ ] Explainable predictions

---

### Задача 3.2: Market Intelligence
- [ ] Data Sources
  - [ ] Industry news aggregation
  - [ ] Market trend tracking
  - [ ] Competitive monitoring
  - [ ] Salary benchmarking
- [ ] Analysis Engine
  - [ ] Trend detection
  - [ ] Pattern recognition
  - [ ] Anomaly detection
  - [ ] Predictive analysis
- [ ] Delivery System
  - [ ] Weekly executive reports
  - [ ] Custom alerts
  - [ ] API access
  - [ ] Data export
- [ ] Actionable Insights
  - [ ] Strategic recommendations
  - [ ] Opportunity identification
  - [ ] Threat detection
  - [ ] Competitive positioning

**Acceptance Criteria:**
- [ ] Become go-to market intelligence source
- [ ] Differentiation for agencies
- [ ] High-value insights
- [ ] Regular actionable content

---

## 💼 P3: Enterprise Scale (26.06-16.07.2026)

### Задача 4.1: Multi-Agency Platform
- [ ] Architecture
  - [ ] Multi-tenant design
  - [ ] Data isolation
  - [ ] Performance optimization
  - [ ] Scalability planning
- [ ] Security & Compliance
  - [ ] Data encryption
  - [ ] Access control
  - [ ] Audit logging
  - [ ] GDPR compliance
- [ ] Features
  - [ ] Shared market intelligence (anonymized)
  - [ ] Competitive protection
  - [ ] Admin dashboard
  - [ ] Usage analytics
- [ ] Onboarding
  - [ ] Agency setup workflow
  - [ ] Training materials
  - [ ] Support integration
  - [ ] Success metrics

**Acceptance Criteria:**
- [ ] Multiple agencies on same platform
- [ ] No data leakage
- [ ] Enterprise-grade security
- [ ] Scalable performance

---

### Задача 4.2: Advanced Features
- [ ] Marketplace
  - [ ] Company-to-agency matching
  - [ ] RFP system
  - [ ] Reviews and ratings
  - [ ] Commission tracking
- [ ] Integrations
  - [ ] CRM integrations
  - [ ] Marketing automation
  - [ ] Accounting software
  - [ ] HR platforms
- [ ] Customization
  - [ ] White-label option
  - [ ] Custom workflows
  - [ ] Branded reports
  - [ ] API access
- [ ] Enterprise Support
  - [ ] Dedicated support
  - [ ] SLAs
  - [ ] Custom development
  - [ ] Training programs

**Acceptance Criteria:**
- [ ] Enterprise-ready platform
- [ ] Customization capabilities
- [ ] High scalability
- [ ] Premium support

---

## 📊 Metrics Tracking

| Категория | Метрика | Целевое | Статус |
|-----------|---------|---------|--------|
| **Pipeline** | Leads/day | 50-100 | 🔴 0 |
| | New companies/week | 20-30 | 🔴 0 |
| | Lead freshness | <2h | 🔴 Н/Д |
| **Conversion** | Lead-to-client | 15-20% | 🔴 Н/Д |
| | Sales cycle | 30-60d | 🔴 Н/Д |
| | Response rate | 30%+ | 🔴 Н/Д |
| **Revenue** | Avg deal size | $5k-20k | 🔴 Н/Д |
| | Monthly rev/agency | $10k-50k | 🔴 Н/Д |
| | ROI | 300%+ | 🔴 Н/Д |
| **Quality** | Lead relevance | 80%+ | 🔴 Н/Д |
| | ICP match | 90%+ | 🔴 Н/Д |
| | Deduplication | <1% | 🔴 5% |

---

## 🔧 Technical Implementation

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

## 🚀 Quick Wins

### This Week
- [ ] Create agency ICP questionnaire
- [ ] Implement basic lead scoring
- [ ] Build outreach template library
- [ ] Set up HH parser for hiring patterns

### Next Week  
- [ ] Add career pages evidence
- [ ] Create lead pipeline UI
- [ ] Implement notification system
- [ ] Build basic dashboard

---

## 🎯 Key Success Indicators

1. **Agencies generate pipeline** - 50+ leads/month
2. **Conversion to clients** - 15-20% of leads become clients
3. **Revenue impact** - $10k-50k/month per agency
4. **Product stickiness** - 80% monthly retention
5. **Word of mouth** - 30%+ from referrals

---

Этот TODO фокусируется на создании полноценной **lead generation platform** для рекрутинговых агентств, а не просто job parser. Каждый элемент направлен на превращение hiring signals в revenue-generating opportunities.