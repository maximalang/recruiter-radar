# Архитектура MVP

## Цель
Сервис каждый день находит компании с сигналами найма, считает score и отправляет лиды в Telegram.

## Источники данных

### Контур 1, primary hiring-signal sources
Источники, которые напрямую дают сигнал, что компания сейчас нанимает:
1. one primary jobs source для первого релиза, например hh.ru API
2. career pages компаний
3. LinkedIn jobs и company pages, либо аналогичные внешние jobs/company sources
4. отдельные tech job boards как следующая волна

### Контур 2, enrichment sources
Источники, которые не создают лид сами по себе, но повышают качество score и контекста:
1. ФНС / ЕГРЮЛ для юридических данных компании
2. сайт компании для контактов, ICP-контекста и дополнительного подтверждения активности
3. funding signals и другие внешние business signals как следующая волна

## Основные части системы

### 1. Data layer
- Postgres
- Таблицы:
  - users
  - orgs
  - subscriptions
  - leads
  - signals
  - lead_status
  - deliveries
  - client_profiles
  - digest_runs
  - digest_candidates
  - client_digest_org_state

### 2. Orchestration
- n8n
- Workflow:
  1. Забрать данные из one primary jobs source
  2. Нормализовать вакансии и компании
  3. При наличии подтянуть enrichment data
  4. Сохранить в БД
  5. Посчитать score
  6. Для каждого client_profile собрать per-client digest run
  7. Отфильтровать повторы через client-level cooldown / suppression / feedback state
  8. Отправить в Telegram
  9. Записать факт доставки

### 3. Backend
- Next.js / Node.js API
- Нужен для:
  - webhook’ов
  - авторизации
  - админки
  - служебных API

### 4. Telegram bot
- Получает дайджест
- Показывает карточки лидов
- Принимает действия по кнопкам:
  - contacted
  - replied
  - won
  - badfit
  - snooze

## Логика MVP

### Поток данных
1. One primary jobs source отдает вакансии или hiring events
2. Сервис сохраняет вакансии и компании
3. Enrichment sources добавляют юридический и контекстный слой
4. Считаются сигналы:
   - рост вакансий
   - массовый найм
   - новые HR-роли
   - мультигород
   - подтверждение активности на career page, company page или другом внешнем hiring surface
5. Считается итоговый score
6. Лучшие лиды отправляются в Telegram

## Что делает LLM
LLM используется только для top-N лидов:
- написать 2 причины “почему сейчас”
- сгенерировать короткий opener

## Что не делаем сейчас
- сложный CRM
- одновременное подключение многих primary hiring-signal sources в первом релизе
- сложную аналитику
- массовый скрейпинг без приоритизации источников
- генерацию текста для всех лидов

## Первый релиз
MVP должен уметь:
1. Получать вакансии из one primary jobs source
2. Сохранять их в Postgres
3. Считать простой score
4. Отправлять лиды в Telegram
5. Менять статус лида по кнопке

## Очередность расширения после первого релиза
1. Добавить career pages компаний как следующий primary hiring-signal source
2. Добавить LinkedIn jobs и company pages, либо аналогичный внешний jobs/company source
3. Подключить ЕГРЮЛ / ФНС как стандартный enrichment source
4. После этого тестировать tech job boards и funding signals