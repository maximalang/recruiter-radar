# recruiter-radar

Минимальный каркас монорепо:
- `apps/web` — Next.js + TypeScript
- `packages/db` — схема БД и миграции

## Локальный запуск

1. Создать `.env` на основе `.env.example`.
2. Поднять базу:
   `docker compose up -d`
3. Установить зависимости:
   `npm install`
4. Запустить web-приложение:
   `npm run dev`

По умолчанию Next.js будет доступен на `http://localhost:3000`.
