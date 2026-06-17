# N8N Workflows

## Deploy n8n to Railway (production, 24/7 scheduler)

n8n runs as a **separate Railway service** from the web app. It builds from the
pinned official image (`n8n/Dockerfile`) using `n8n/railway.toml`.

### 1. Create the service
- Railway Dashboard → your project → **New** → **GitHub Repo** (same repo).
- In the new service → **Settings → Build**:
  - **Config-as-code path** = `n8n/railway.toml`
    (or set **Root Directory** = `n8n/` — either makes Railway use this service's config).
- This service deploys independently from the web service; both live in one project.

### 2. Add a persistent volume (REQUIRED — cannot be set in railway.toml)
Railway volumes are attached via Dashboard/CLI only, not config-as-code.
- Service → **Settings → Volumes → Add Volume**
- **Mount path:** `/data`
- This persists workflows, credentials, and the SQLite DB across restarts/redeploys.
- Without it, every redeploy wipes imported workflows and credentials.

### 3. Set environment variables (Dashboard → Variables)
Never commit these — they live only in Railway.

| Variable | Value | Notes |
|---|---|---|
| `N8N_BASIC_AUTH_ACTIVE` | `true` | Protect the editor UI |
| `N8N_BASIC_AUTH_USER` | `admin` | |
| `N8N_BASIC_AUTH_PASSWORD` | *(generate strong)* | e.g. `openssl rand -base64 24` |
| `N8N_HOST` | `0.0.0.0` | Bind all interfaces |
| `N8N_PORT` | `5678` | |
| `N8N_PROTOCOL` | `https` | Railway terminates TLS |
| `WEBHOOK_URL` | `https://<n8n-service>.up.railway.app` | Set after first deploy gives you the domain |
| `N8N_ENCRYPTION_KEY` | *(generate 32-char)* | `openssl rand -hex 16` — **never lose this**, it decrypts stored credentials |
| `RR_APP_BASE_URL` | `https://recruiter-radarweb-production.up.railway.app` | Where workflows POST (web service) |
| `CRON_API_KEY` | *(same value as web service)* | Must match the web service's `CRON_API_KEY` |
| `DB_TYPE` | `sqlite` | |
| `N8N_USER_FOLDER` | `/data` | Must match the volume mount path |

> The workflows also reference `DIGEST_API_KEY`, `INGEST_API_KEY`, and
> `TELEGRAM_OPERATOR_CHANNEL_ID` (they fall back to `CRON_API_KEY` where applicable).
> Add those too if you activate `daily-signals` / `career-pages-daily` / `operational-alerts`.

### 4. After Railway deploys
1. Open the n8n UI at the Railway-assigned URL (`https://<n8n-service>.up.railway.app`), log in with the basic-auth creds.
2. Go back to **Variables**, set `WEBHOOK_URL` to that exact URL, and redeploy if it wasn't known at first boot.
3. **Import workflows:** for each file in `n8n/workflows/*.json` → top-right menu → **Import from File**.
4. **Configure each imported workflow:**
   - Confirm `RR_APP_BASE_URL` and `CRON_API_KEY` resolve (they read from this service's env).
   - For `daily-signals`: attach the Postgres credential and Telegram bot token (see below).
5. **Activate** each workflow (toggle top-right). Inactive workflows do not run on schedule.
6. **Test `hh-daily` manually:** open it → **Execute Workflow** (or **Test workflow**) → watch the
   "Call Daily Radar API" node return `200`/`207`. A `401` means `CRON_API_KEY` mismatch with the web service.

### Schedules (MSK) once activated
| Workflow | Time | Calls |
|---|---|---|
| `hh-daily` | 06:00 | `POST /api/cron/daily-radar` |
| `career-pages-daily` | 07:00 | `POST /api/sources/ingest` |
| `daily-signals` | 08:00 | `POST /api/digest/delivery` |

### Upgrading n8n
Bump the tag in `n8n/Dockerfile` (currently `1.107.4`) deliberately — read the n8n
changelog first. The `/data` volume + `N8N_ENCRYPTION_KEY` carry your state across versions.

---

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