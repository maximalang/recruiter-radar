# recruiter-radar

Recruiter Radar — сервис для поиска компаний с активными hiring signals и отправки готовых лидов в Telegram.

## Source model: quality-first evidence

Текущий MVP запускается с одним активным primary platform source (`hh`), но модель источников уже описывает не vendor-first каталог, а стек доказательств качества:

- **sourceClass** — роль источника в пайплайне доказательств (`primary-platform`, `company-surface`, `registry-reference`, `market-signal`)
- **evidenceTier** — ожидаемое качество и прямота сигнала (`high-signal`, `medium-signal`, `context-only`)
- **defaultConfidence** — базовый confidence по умолчанию для будущего score layering; это только metadata, без изменения текущей scoring logic
- **status** — `active` для runnable источников, `planned` для metadata-only направлений

Сейчас `hh` остаётся дефолтным primary entrypoint для `source:*` команд, а `career-pages` стал отдельным runnable source для прямых company career page fetch/ingest сценариев. Это вопрос текущего покрытия, а не смыслового центра модели.

Planned expansion остаётся phased:
- next primary/platform or company-surface sources: career pages компаний, LinkedIn jobs/company pages, другие external jobs/company sources
- enrichment/reference/context sources: ЕГРЮЛ / ФНС, сайт компании, funding signals и смежные business signals

`npm run source:list` теперь должен читаться как реестр evidence sources: какие источники активны, какие только запланированы, какой у них quality tier и baseline confidence.

## Command compatibility

Текущая HH-совместимость сохранена:
- `npm run source:fetch`, `npm run source:ingest`, `npm run source:pipeline` по-прежнему используют `hh` как current primary source
- `npm run source:fetch:primary`, `npm run source:ingest:primary`, `npm run source:pipeline:primary` явно фиксируют это поведение как временный primary default
- `npm run hh:*` алиасы сохранены без изменений для текущих отчётов и локальных workflows
- `npm run source:fetch:career-pages`, `npm run source:ingest:career-pages`, `npm run source:pipeline:career-pages` запускают отдельный карьерный source

Никакого scoring refactor здесь ещё нет: это stage 1 vocabulary/model prep для будущего quality-aware ranking.

## Per-client digest core

Добавлен минимальный per-client digest core поверх source-agnostic evidence query:
- `digest_runs` хранит запуск дайджеста по конкретному `client_profile`
- `digest_candidates` фиксирует фактически отобранные компании
- `client_digest_org_state` держит cooldown / suppression / feedback state по клиенту и компании
- `GET /api/digest?clientProfileId=<id>` запускает один digest run и возвращает выбранные кандидаты
- `POST /api/digest/feedback` пишет feedback/suppression state (`accepted`, `badfit`, `dismissed`, `snooze`, а также `contacted` / `replied` / `won`) по `clientProfileId + orgId` или `digestCandidateId`
- `npm run verify:digest:feedback` прогоняет DB-backed smoke для mutation path, если доступен `DATABASE_URL`

Старый `GET /api/hh/digest` сохранён как preview-совместимый top list без записи состояния.

## Локальный запуск

1. Создать `.env` на основе `.env.example`.
2. Поднять локальную инфраструктуру:
   `docker compose up -d`
3. Установить зависимости:
   `npm install`
4. Запустить web-приложение:
   `npm run dev`

По умолчанию Next.js будет доступен на `http://localhost:3000`.
Локальный n8n будет доступен на `http://localhost:5678`.

## Career pages source

`career-pages` теперь умеет не только ingest готового файла, но и самостоятельный fetch вакансий из конфигурации таргетов.

Минимальная конфигурация:
1. Либо скопировать `packages/db/scripts/career-pages-targets.example.json` в `packages/db/scripts/career-pages-targets.json` и заполнить targets вручную,
2. Либо оставить manual targets пустыми и запустить source с `DATABASE_URL`: тогда включится repo-native auto-discovery по уже сохранённым `hh` org/signal seed-данным.
3. Поддерживаемые adapter-ы:
   - `greenhouse-board` — для Greenhouse board API (`https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`)
   - `lever-postings` — для Lever postings API (`https://api.lever.co/v0/postings/<token>?mode=json`)
   - `json-feed` — для собственного JSON feed в shape array / `{ records: [...] }`
4. Опционально переопределить путь через `CAREER_PAGES_TARGETS_FILE`.
5. Опционально задать `CAREER_PAGES_FETCH_OUTPUT_FILE`, если snapshot fetch нужно писать не в `packages/db/scripts/.cache/career-pages-fetch.json`.
6. Для auto-discovery можно ограничить размер выборки через `CAREER_PAGES_DISCOVERY_LIMIT`; найденные runnable targets пишутся в `packages/db/scripts/.cache/career-pages-discovered-targets.json`, а unresolved review boundary — в `packages/db/scripts/.cache/career-pages-discovery-review.json`.

Команды:
- `npm run source:fetch:career-pages` — fetch + нормализация без записи в БД; без manual targets попробует auto-discovery из БД и company-site probe
- `npm run source:ingest:career-pages` — ingest в БД; если `CAREER_PAGES_INPUT_FILE` не задан, сначала читается targets-конфиг
- `npm run source:pipeline:career-pages` — fetch/normalize + ingest в одном запуске
- `npm run career-pages:smoke` — детерминированный smoke через локальный static target fixture
- `npm run verify:career-pages:smoke` — read-only verifier для smoke fixture без БД
- `npm run verify:career-pages:discovery` — read-only smoke на HTML detection / target generation для auto-discovery
- `npm run verify:career-pages:ingest` — явный DB-backed verify ingest path на временном fixture с cleanup после проверки

Для обратной совместимости `CAREER_PAGES_INPUT_FILE` по-прежнему поддерживается как snapshot/input override для ingest и pipeline.
