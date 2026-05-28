# План: B2B Lead Generation для рекрутинговых агентств

**Версия:** 1.0  
**Обновлено:** 2026-05-26  
**Фокус:** Lead generation → recruitment agencies → new clients

---

## 🎯 Переосмысление позиционирования

Recruiter Radar — **не** просто агрегатор вакансий. Это **intelligence radar**, который помогает рекрутинговым агентствам находить **новых клиентов** (компании, которым нужен рекрутинг) на основе hiring signals.

### Key Difference:
- **Job boards** → кандидаты на вакансии  
- **Recruiter Radar** → компании-клиенты для агентств

---

## 🎯 Фаза 1: Core Lead Generation (1-2 недели)

### Задача 1.1: Lead Scoring for Agencies
**Цель:** Определить какие компании — лучшие клиенты для рекрутинговых агентств

**Scoring Factors:**
1. **Fit** (40%)
   - Industry match (IT/FinTech/ etc.)
   - Company size (ideal: 50-500 employees)
   - Geography (Москва/СПб/регионы)
   - Exclusions (gov, non-profits)

2. **Intent** (30%)  
   - Multiple open vacancies (>3)
   - Variety of roles (не только junior)
   - Freshest postings (<7 дней)
   - Premium salary levels

3. **Urgency** (20%)
   - Hard-to-fill roles
   - Rapid hiring (burst pattern)
   - New positions vs. replacements
   - Competition indicators

4. **Reachability** (10%)
   - Public contact info
   - Career page with HR contacts
   - Company website quality
   - Social media presence

**Приёмка:**
- Score коррелирует с conversion rate
- 70%+ leads are relevant to agencies
- Clear next action for each lead

### Задача 1.2: Agency-Specific Lead Format
**Цель:** Сделать лиды actionable для рекрутеров

**Lead Template:**
``🎯 [Компания] - [Роль/Индустрия]*
💡 Почему сейчас: [evidence - 3 bullet points]  
📊 [Score: X.X/4.0] | Confidence: [A/B]
📍 [Локация] | [Зарплата: от X до Y]
🔗 [Safe contact path]
👉 [Next action: пример первого сообщения]
```

**Приёмка:**
- Рекрутеры понимают ценность сразу
- Clear call-to-action
- Evidence-based, not promises

### Задача 1.3: Competitive Intelligence
**Цель:** Помочь агентствам понять конкурентное поле

**Features:**
- Companies hiring same roles as client
- Salary benchmarks by role/level
- Market saturation analysis
- Agency specialization mapping

**Приёмка:**
- differentiation strategy for agencies
- Pricing intelligence
- Market positioning insights

---

## 🚀 Фаза 2: Lead Nurturing (2-3 недели)

### Задача 2.1: Multi-Touch Campaigns
**Цель:** Автоматизировать последовательность контактов

**Campaign Flow:**
1. **First touch:** Personalized outreach based on hiring signals
2. **Follow-up:** Share new hiring activity  
3. **Value add:** Market insights/comp analysis
4. **Close:** Trial proposal/consultation

**Automation:**
- Telegram digest + email backup
- Personalized templates
- Track engagement metrics

**Приёмка:**
- 3+ touch points before conversion
- 30%+ response rate
- Personalized at scale

### Задача 2.2: Lead Management System
**Цель:** Full CRM-lite for agencies

**Features:**
- Lead status tracking (New → Contacted → Meeting → Proposal → Client)
- Tagging by industry/size/location
- History of interactions
- Pipeline management
- Analytics on conversion rates

**Приёмка:**
- No need for external CRM initially
- 80%+ agencies can use as primary tool
- Easy export to existing CRM

---

## 📈 Фаза 3: Agency-Specific Analytics (2 недели)

### Задача 3.1: Performance Metrics
**Цель:** Показать ROI lead generation

**Key Metrics:**
- Lead-to-client conversion rate
- Average deal size
- Sales cycle length
- Cost per acquisition
- Industry performance comparison

**Dashboards:**
- Agency performance vs. industry
- Best practices from top performers  
- ROI calculator
- Lead quality scoring

**Приёмка:**
- Clear ROI demonstration
- Benchmarking capabilities
- Actionable insights

### Задача 3.2: Market Intelligence
**Цель:** Поставить агентства в позицию экспертов

**Features:**
- Industry hiring trends
- Salary movements
- Talent availability
- Competitive hiring patterns
- Emerging markets

**Format:**
- Weekly market reports
- Custom alerts for changes
- Presentation-ready insights

**Приёмка:**
- Become go-to resource in niche
- Data-driven positioning
- Thought leadership content

---

## 💼 Фаза 4: Enterprise Features (3-4 недели)

### Задача 4.1: Multi-Agency Features
**Цель:** Поддержка нескольких агентств

**Features:**
- Agency-specific ICP settings
- Shared market intelligence (anonymized)
- Competitive protection (no overlap)
- Team collaboration tools
- Billing/usage tracking

**Приёмка:**
- Multiple agencies on same platform
- No data leakage
- Scalable onboarding

### Задача 4.2: Agency Marketplace
**Цель:** Connect companies with right agencies

**Matching:**
- By industry specialization
- By company size/needs
- By location
- By budget/requirements

**Features:**
- Agency profiles
- Company RFPs
- Review system
- Commission tracking

**Приёмка:**
- Quality matches
- Reduced sales cycle
- Win-win for both sides

---

## 🎯 Lead Generation Success Metrics

| Категория | Метрика | Целевое значение | Значение для агентов |
|-----------|---------|------------------|---------------------|
| **Quality** | Lead relevance | 80%+ | Higher conversion |
| | ICP match | 90%+ | Better fit clients |
| | Response rate | 30%+ | Effective outreach |
| **Quantity** | Leads/month/agency | 50-100 | Sufficient pipeline |
| | New companies/week | 20-30 | Fresh opportunities |
| **Conversion** | Lead-to-client | 15-20% | Measurable ROI |
| | Sales cycle | 30-60 days | Realistic timeline |
| **Value** | Avg deal size | $5k-20k | Healthy revenue |
| | Monthly revenue/agency | $10k-50k | Sustainable business |

---

## 🎯 Agency Value Proposition

### For Small Agencies (1-10 people)
- **Problem:** Manual prospecting, low-quality leads
- **Solution:** Automated radar + quality scoring
- **Value:** Focus on sales, not research

### For Mid-size Agencies (11-50 people)  
- **Problem:** Scaling lead gen, market intel
- **Solution:** Systematic lead management
- **Value:** Predictable pipeline, competitive edge

### For Specialized Agencies
- **Problem:** Finding niche clients
- **Solution:** Filtered by industry/specialization
- **Value:** Perfect match, higher margins

---

## 🛠️ Implementation Focus

### Lead Generation Engine
```typescript
interface AgencyLead {
  // Basic info
  company: Company;
  primaryContact: ContactPath;
  
  // Lead quality
  score: number;
  confidence: 'A' | 'B' | 'C';
  reasons: string[];
  
  // Agency-specific
  match: {
    industryFit: number;
    roleFit: number;
    locationFit: number;
  };
  
  // Next action
  action: {
    type: 'email' | 'telegram' | 'call';
    template: string;
    timing: string;
  };
}
```

### Agency Workflow
```
Daily Digest → Review Leads → Prioritize → Outreach → 
Track Responses → Schedule Follow-up → Close Deal → 
Feedback Loop → Better Future Leads
```

---

## 💡 Quick Wins для Агентств

1. **Agency-specific templates** - готовые скрипты для первого контакта
2. **Competitive alerts** - "Компания X нанимает в вашей нише"  
3. **Salary benchmarks** - "Обычно платят X за эту роль в Y"
4. **Timing insights** - "Лучшее время для контакта - вторник 10:00"
5. **Objection handling** - контраргументы для частых возражений

---

Этот план фокусируется именно на **B2B lead generation**, что принципиально отличается от обычных job boards. Рекрутинговые агентства платят за качественных клиентов, а не за вакансии.