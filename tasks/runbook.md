# Runbook: Lead Generation Platform Implementation

**Связано:** `tasks/plan.md` (стратегический план), `tasks/todo.md` (детальные задачи)
**Обновлено:** 2026-05-26

Этот документ содержит пошаговые команды для каждой задачи из плана разработки.

---

## 🏗️ Команды для разработки

### Lead Discovery System

```bash
# Улучшение HH parser
npm run source:pipeline:hh
npm run hh:report
npm run verify:source:confidence

# Career pages parsing
npm run career-pages:smoke
npm run source:pipeline:career-pages

# Signal aggregation
npm run lead:generate
npm run verify:lead:quality
```

### Lead Scoring

```bash
# FIUR scoring system
npm run verify:scoring:fiur
npm run analytics:performance

# Agency-specific scoring
npm run lead:score -- --agency-id=<agency-id>
```

### Agency Profile System

```bash
# Create agency profile
npm run agency:create-profile -- --input=agency-profile.json

# Update ICP settings
npm run agency:update-icp -- --agency-id=<id> --icp=icp-config.json

# Performance tracking
npm run analytics:agency-performance -- --agency-id=<id>
```

---

## 📊 Команды для проверки качества

```bash
# Проверка качества лидов
npm run verify:lead:quality
npm run verify:lead:duplicates
npm run verify:scoring:accuracy

# Метрики покрытия
npm run source:coverage
npm run verify:source:confidence
npm run analytics:source-performance

# Тесты производительности
npm run test:lead-generation -- --verbose
npm run benchmark:scoring
```

---

## 📈 Команды для аналитики и отчетности

```bash
# Dashboard metrics
npm run analytics:dashboard
npm run analytics:roi -- --agency-id=<id>

# Отчеты
npm run reporting:daily
npm run reporting:weekly
npm run reporting:custom -- --output=report.csv

# А/B тестирование
npm run ab:test:start -- --test-name=scoring-v2
npm run ab:test:results -- --test-id=<id>
```

---

## 🔧 Команды для DevOps

```bash
# Локальная разработка
npm run dev
npm run web:check
npm run test

# Docker окружение
docker compose up -d
docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c "\dt"

# Деплой
npm run build
npm run deploy:staging
npm run deploy:production
```

---

## 🚀 Запуск новых фич

### 1. Новые источники данных
```bash
# Добавить новый источник
npm run source:create -- --name=<source-name> --type=<hh/career-pages/rabota>

# Тест нового источника
npm run source:test -- --source=<source-name>

# Проверить качество
npm run source:verify -- --source=<source-name>
```

### 2. Улучшения скора
```bash
# Тестировать новую модель
npm run scoring:test -- --model=<model-name>

# Запустить A/B тест
npm run scoring:ab-test -- --variant=A --variant=B

# Проверить результаты
npm run scoring:analyze -- --test-id=<id>
```

### 3. Агентские фичи
```bash
# Создать тестовое агентство
npm run agency:create-test -- --name=<name>

# Загрузить тестовые лиды
npm run lead:generate-test -- --agency-id=<id> --count=10

# Запустить outreach тест
npm run outreach:test -- --agency-id=<id>
```

---

## 📝 Команды для документации

```bash
# Генерация документации
npm run docs:generate
npm run docs:deploy

# Проверить спецификацию
npm run spec:validate

# Создать миграцию
npm run db:migrate:create -- --name=<migration-name>
```

---

## 🔍 Отладочные команды

```bash
# Логирование
npm run debug:lead-generation -- --verbose=true
npm run debug:scoring -- --lead-id=<id>

# Профилирование
npm run profile:scoring -- --duration=30
npm run profile:memory -- --iterations=100

# Тесты edge cases
npm run test:edge-cases
npm run test:error-handling
```

---

## 💡 Quick Commands

```bash
# Полный smoke test
npm run verify:smoke

# Проверить все источники
npm run source:list
npm run source:test-all

# Базовая аналитика
npm run analytics:overview
npm run leaderboard:agencies

# Сброс тестовых данных
npm run db:reset-test
npm run data:regenerate-test
```

---

## 🎯 Пошаговый запуск фич

### Core Lead Generation Engine

1. **HH Parser Enhancements**
   ```bash
   npm run source:pipeline:hh
   npm run verify:hiring-patterns
   npm run verify:non-tech-roles
   ```

2. **Career Pages Improvements**
   ```bash
   npm run career-pages:discovery
   npm run career-pages:extract-contact-paths
   npm run verify:career-page-quality
   ```

3. **Signal Aggregation**
   ```bash
   npm run lead:generate
   npm run verify:unified-lead-format
   npm run test:freshness-tracking
   ```

### Lead Management System

1. **Pipeline CRM Setup**
   ```bash
   npm run pipeline:init
   npm run verify:workflow-transitions
   npm run test:drag-and-drop
   ```

2. **Outreach Automation**
   ```bash
   npm run outreach:setup-templates
   npm run verify:personalization
   npm run test:multi-channel-delivery
   ```

### Analytics & Intelligence

1. **Advanced Scoring**
   ```bash
   npm run scoring:train-model
   npm run ab:test:scoring-models
   npm run verify:prediction-accuracy
   ```

2. **Market Intelligence**
   ```bash
   npm run intel:setup-trends
   npm run intel:generate-reports
   npm run verify:actionable-insights
   ```

---

Эти команды помогут быстро проверять каждую разработанную фичу и убедиться, что все работает как ожидается.