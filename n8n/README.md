# N8N Workflows

## daily-signals.json
Основной workflow для Recruiter Radar.

### Что делает
1. Запускается по расписанию
2. Забирает из Postgres лиды со статусами:
   - new
   - contacted
   - replied
3. Сортирует по score и дате сигнала
4. Отправляет лиды в Telegram
5. Не отправляет повторно уже доставленные лиды

### Файл
- `n8n/workflows/daily-signals.json`

### Как импортировать
1. Открыть n8n
2. Import from file
3. Выбрать `n8n/workflows/daily-signals.json`

### Что нужно для работы
- запущенный Postgres
- запущенный n8n
- Telegram bot token
- Telegram chat id
- Postgres credentials внутри n8n

### Что проверить после импорта
- Postgres credential подключен
- HTTP Request использует правильный Telegram bot token
- chat_id указан верно
- workflow активирован
- в HTTP Request к `/api/hh/digest` передаётся заголовок `x-api-key` со значением из `DIGEST_API_KEY`