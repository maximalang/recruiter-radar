# Спецификация: Recruiter Radar MVP Completion

**Версия:** 2.0
**Обновлено:** 2026-05-25
**Статус:** Планирование

## 1. Объектив

Довести MVP до полного продуктового состояния:
- Приложение работает без ошибок
- Пользователи могут зайти, оформить заказ и получить лиды
- Лиды генерируются из HH и доставляются в Telegram/на сайт

## 2. Целевой пользователь

Российские рекрутинговые агентства, которым нужны компании с активным наймом.

## 3. Источники данных (должны работать)

| Источник | Тип | Статус | API/Токен |
|----------|-----|--------|-----------|
| **HH.ru** | job-board | ✅ Есть | HH_USER_AGENT (публичный) |
| **Career Pages** | career-page | ⚠️ Есть | Greenhouse/Lever API (публичный) |
| **LinkedIn** | professional-network | ⚠️ Есть | Provider token required |
| **Rabota Rossii** | job-board | ⚠️ Есть | opendata.trudvsem.ru (публичный API) |
| **Tech Job Boards** | job-board | ⚠️ Есть | HeadHunter/other APIs |
| **Company Sites** | company-surface | ⚠️ Есть | Скрапинг |
| **EGRUL/FNS** | company-registry | ⚠️ Есть | ФНС API |
| **Company Newsrooms** | business-signal | ⚠️ Есть | Пресса/PR |
| **Funding/Business Signals** | business-signal | ⚠️ Есть | Публичные данные |
| **Industry Media** | business-signal | ⚠️ Есть | СМИ |
| **Habr Career** | job-board | ⚠️ Есть | Публичный |
| **SuperJob** | job-board | ⚠️ Есть | Provider token |

**Текущая проблема:** Скрипты есть, но они не подключены к n8n workflow и не загружают данные в базу автоматически.

## 4. Что нужно сделать для работы всех источников

### 4.1 HH.ru (приоритет P0)
- [x] Скрипт: `packages/db/scripts/fetch-hh.mjs`
- [ ] Скрипт: `packages/db/scripts/ingest-hh.mjs`
- [ ] Подключение к n8n workflow
- [ ] Проверка работы с реальным HH API

### 4.2 Career Pages (приоритет P1)
- [x] Скрипт: `packages/db/scripts/source-career-pages.mjs`
- [ ] Таблица targets с компаниями для парсинга
- [ ] Интеграция Greenhouse/Lever API
- [ ] n8n workflow

### 4.3 LinkedIn (приоритет P2)
- [x] Скрипт: `packages/db/scripts/source-linkedin-company-pages.mjs`
- [ ] **Требует**: LINKEDIN_PROVIDER_API_TOKEN
- [ ] Выбор провайдера (Apollo, Clearbit, etc.)

### 4.4 Rabota Rossii (приоритет P1)
- [x] Скрипт: `packages/db/scripts/source-rabota-rossii.mjs`
- [ ] Публичный API: `opendata.trudvsem.ru`
- [ ] n8n workflow

### 4.5 Tech Job Boards (приоритет P2)
- [x] Скрипт: `packages/db/scripts/source-tech-job-boards.mjs`
- [ ] n8n workflow

### 4.6 Company Sites (приоритет P2)
- [x] Скрипт: `packages/db/scripts/source-company-site.mjs`
- [ ] n8n workflow

### 4.7 EGRUL/FNS (приоритет P2)
- [x] Скрипт: `packages/db/scripts/source-egrul-fns.mjs`
- [ ] ФНС API integration

### 4.8 Остальные источники (приоритет P3)
- Company Newsrooms ✅
- Funding Business Signals ✅
- Industry Media ✅
- Habr Career ✅
- SuperJob ✅
- Regional Job Boards ✅
- Fedresurs ✅

## 5. Что нужно сделать для MVP

### Фаза 1: База данных (1 день)
**Цель:** Поднять рабочую базу данных с миграциями.

- [ ] Применить миграции к БД
- [ ] Проверить таблицы
- [ ] Seed-данные (опционально)

**Верификация:** `docker exec recruiter-radar-db-1 psql -U postgres -d recruiter_radar -c "\dt"` показывает таблицы.

### Фаза 2: HH.ru как primary source (2 дня)
**Цель:** HH работает полностью — собирает вакансии, создаёт лиды.

- [ ] Запустить `npm run hh:fetch` — получить реальные вакансии
- [ ] Запустить `npm run hh:ingest` — записать в БД
- [ ] Подключить к n8n workflow
- [ ] Проверить FIUR scoring и gates
- [ ] Проверить доставку в Telegram

**Верификация:** В БД появляются org_source_refs с HH данными.

### Фаза 3: Career Pages + Rabota Rossii (2 дня)
**Цель:** Добавить источники с российского рынка.

- [ ] Настроить targets для career pages
- [ ] Запустить source-career-pages.mjs
- [ ] Запустить source-rabota-rossii.mjs
- [ ] Проверить deduplication с HH

**Верификация:** Лиды из разных источников появляются в digest.

### Фаза 4: Интеграция LinkedIn + Tech Job Boards (2 дня)
**Цель:** Расширить покрытие источников.

- [ ] Получить LINKEDIN_PROVIDER_API_TOKEN
- [ ] Настроить LinkedIn scraper
- [ ] Интегрировать tech job boards
- [ ] Проверить confidence scoring

### Фаза 5: Checkout + Onboarding (1 день)
**Цель:** Пользователь может заказать и активировать.

- [ ] Checkout flow
- [ ] Telegram onboarding
- [ ] Billing webhook

### Фаза 6: UI/UX (2 дня)
**Цель:** Сайт выглядит профессионально.

- [ ] Лендинг
- [ ] Dashboard
- [ ] Mobile responsive

### Фаза 7: n8n orchestration (1 день)
**Цель:** Автоматизация всех источников.

- [ ] Запустить n8n
- [ ] Настроить все workflows
- [ ] Расписание (daily)

---

## 6. Приоритеты

```
P0 (критично для MVP):
├── Фаза 1: Миграции БД
├── Фаза 2: HH.ru (primary source)
└── Фаза 5: Checkout + Onboarding

P1 (нужно для лидов):
├── Фаза 3: Career Pages + Rabota Rossii
└── Фаза 7: n8n orchestration

P2 (улучшает продукт):
├── Фаза 4: LinkedIn + Tech Job Boards
└── Фаза 6: UI/UX
```

## 7. Критерии приёмки

| Критерий | Описание |
|----------|----------|
| База данных | Таблицы созданы, миграции применены |
| HH работает | Вакансии собираются, лиды создаются |
| Sources работают | Career Pages, Rabota Rossii подключены |
| Checkout работает | Можно оформить заказ |
| Onboarding работает | Telegram бот подключается |
| UI приемлемый | Сайт выглядит профессионально |
| n8n автоматизирован | Daily workflows запускаются |

## 8. Границы

### Всегда делать:
- TypeScript strict mode
- Проверять типы перед коммитом
- Тесты для новой функциональности
- Не коммитить секреты

### Спрашивать первым:
- Изменения в схеме БД
- Новые npm зависимости > 100KB
- Изменения API контракта

### Никогда не делать:
- Использовать `any` без необходимости
- Коммитить `.env` файлы
- Добавлять inline стили в React

## 8. Технический стек

- **Frontend:** Next.js 16 (React 19)
- **Language:** TypeScript strict
- **Database:** PostgreSQL 15
- **Orchestration:** n8n
- **Deployment:** Docker Compose

---

**Следующий шаг:** Начать с Фазы 1 — применить миграции к БД.