# Runbook: VM tick authority для Source Refresh Clock (amendment протокола v2)

Status: **draft — НЕ применён на production** · 2026-08-29 · Task `t_daf4a05e` · Branch `codex/source-refresh-vm-authority`
Amends: `docs/runbooks/proof-protocol-7day-live-window.md` v2 (§9.1, §15, §17.2) на ветке `codex/source-refresh-clock-v4` (PR #240).

## 0. Резюме для reviewer'а

GitHub Actions `schedule` объективно не обеспечивает 24 запуска/день: schedule-события
workflow **Source Refresh Clock** (evidence: `gh run list --workflow="Source Refresh Clock"`,
2026-08-29):

| UTC-день | schedule runs | вывод гейта окна |
| --- | --- | --- |
| 2026-08-23 | 23 | RED (1 слот потерян) |
| 2026-08-24 | 23 | RED |
| 2026-08-25 | 23 | RED |
| 2026-08-26 | 16 | RED |
| 2026-08-27 | 3 | RED |
| 2026-08-28 | 2 | RED |
| 2026-08-29 | 1 (к 07:30Z) | RED |

Решение (архитектурное, владелец @rr-support): **VM-side systemd timer становится
единственным authoritative tick generator**. GHA `source-refresh-clock.yml` остаётся
manual/recovery probe с `authority=github-manual` и **не может** закрыть slot или день.
Никаких двух равноправных authorities.

Этот документ: (a) amendment протокола, (b) implementation-ready ops plan, (c)
unit/timer/service контракты, (d) rollback. **Применение на VDS — только после fresh
snapshot + pg_dump, явного owner gate и merged reviewed protocol** (см. §7).

## 1. Модель authority (замена §9.1 протокола — правила окна)

Принято к §9 протокола («Правила 7-дневного окна») новый пункт **9.1**:

> **9.1. Authoritative tick generator.** Ровно 24 authoritative UTC slot'а в сутки
> генерирует исключительно systemd timer `rr-source-refresh.timer` на production host
> (`OnCalendar=*:15:00 UTC`, `Persistent=true`). Tick с `authority=vm-systemd` —
> единственное основание для `tick_result=ok` slot'а в sense §17.2. Запуски из GitHub
> Actions (`workflow_dispatch` или `schedule`) **помечаются**
> `authority=github-manual` / `authority=github-schedule-legacy` в probe-ответе, но
> не создают ledger-slot, не закрывают slot и не влияют на day-level
> статус. Второй `vm-systemd` запрос для уже claimed slot'а — чистый no-op
> (`duplicate_skipped`), а non-authoritative probe не участвует в slot ledger.

Причина: GHA schedule деградировал с 23 до 1–3 runs/день (§0), при этом протокол v2
требует 24 expected slots/день (§17.2) и RED на каждый missing/late slot (§9.3).
Single-writer принцип уже закреплён репо-контрактом («GitHub Actions is the only
repository-authorized production clock», `production-scheduler-authority.md`) — amendment
переносит эту роль на VM timer и понижает GHA до probe.

## 2. Замена §17.2 протокола — tick ledger, exactly-once, контракт ряда

Каждый тик выполняет **один** HTTP-вызов к `web`-контейнеру по `127.0.0.1:3000`
внутри host (наружу ничего не слушается):

`POST /api/cron/source-refresh` с authoritative metadata (§2.2). Route сначала атомарно
claim'ит ledger-slot, затем — только для успешного claim — вызывает существующий
`runScheduledSourceRefresh()` in-process. Это сохраняет единый product route и не вводит
второй orchestration endpoint.

### 2.1 Слот

- `slot_id = floor((observed_at − 15min grace) / 1h)` в UTC, формат
  `YYYY-MM-DDTHH:00:00Z`. Совпадает с §17.4 протокола (grace 15 минут).
- `scheduled_at` — расчётное время слота (по `TIMERS_MONOTONIC`/wake system, см. §4.4);
  `observed_at` — фактическое время запуска tick-скрипта (UTC, ISO-8601).
- День D содержит tick'и `[D 00:00Z, D+1 00:00Z)`; слоты принадлежат ровно одному дню
  (§17.4.1 протокола — без изменений).

### 2.2 Ряд ledger'а (`source_refresh_tick_ledger`)

| Поле | Тип | Смысл |
| --- | --- | --- |
| `slot_id` | text, PK | `YYYY-MM-DDTHH:00:00Z`, canonical UTC |
| `scheduled_at` | timestamptz | planned время слота |
| `observed_at` | timestamptz | фактический старт тика |
| `attempt` | integer | 1 для первого INSERT слота; инкремент невозможен (PK) — повторы идут в `tick_result='duplicate_skipped'` |
| `authority` | text | `vm-systemd` \| `github-manual` \| `github-schedule-legacy` |
| `deploy_sha` | text null | 40-hex из `/api/health` `version.deploySha` на момент тика |
| `tick_result` | text | `success` \| `degraded_ok` \| `red` \| `no_op_422` \| `schema_error` \| `duplicate_skipped` |
| `refresh_http_status` | integer null | 200/207/422/… ответа refresh endpoint |
| `detail` | jsonb | counters + `failedRequired` + `failedOptional` + `deliveryImpactingFailure` (PII-free, §17.5.4 протокола) |
| `created_at` | timestamptz | INSERT-only аудит |

Exactly-once: PK на `slot_id` + `INSERT ... ON CONFLICT DO NOTHING`; вставка разрешена
только при `authority='vm-systemd'` (CHECK-констрейнт на уровне endpoint-логики; GHA-run
никогда не пишет ряд сам, его факт фиксируется только в return-обёртке §2.3).

### 2.3 Идемпотентность повторов

`tick_idempotency`-логика **внутри `/api/cron/source-refresh`**:

```
INSERT INTO source_refresh_tick_ledger (...) VALUES (...)
ON CONFLICT (slot_id) DO NOTHING RETURNING slot_id;
```

- INSERT удался → ряд записан, дальнейшая логика (§2.4) выполняется;
- конфликт (slot уже claimed) → ответ `409 {duplicate:true}` без side-effects;
  скрипт тика завершается exit 0 (`duplicate_skipped`), а source scheduler **не**
  вызывается.

### 2.4 Маппинг исхода (совместим с §17.6 протокола)

| refresh HTTP | summary | tick_result | slot день-статус |
| --- | --- | --- | --- |
| 200 | green/degraded, failedRequired=0 | `success` | вклад в GREEN_DAY |
| 207 | optional-only в бюджете §7 | `degraded_ok` | вклад в GREEN_DAY |
| 207 | required failure или вне бюджета | `red` | RED слот |
| 422 | no_active_profiles | `no_op_422` | slot закрыт, день не портит |
| timeout/5xx/malformed | — | `red` | RED слот |
| 409 duplicate | — | `duplicate_skipped` | no-op |

Lateness budget: authoritative request для `slot_id` допустим лишь при
`observed_at <= slot_id + 01:15:00Z`. Иначе route пишет `tick_result='red'` с
`detail.late=true` и **не** выполняет refresh — slot уже потерян для окна
(fail-closed §9.3 протокола). `Persistent=true` может поднять service после downtime,
но скрипт всегда вычисляет slot из фактического `observed_at`; он **не** может
синтезировать исторический slot. Пропущенные historical slots остаются отсутствующими в
ledger и RED при close-watermark, а не получают задним числом зелёный результат.

## 3. Изменение §15 протокола — ответственность

Дополняется пунктами:

> - Владелец systemd timer'а на production host — @rr-ops (установка, мониторинг,
>   `systemctl list-timers`, journal-квоты). Владелец контракта endpoint'а и ledger-таблицы
>   — @rr-backend (миграция + route). Изменение расписания/authority-модели — только через
>   amendment протокола и merge в `main`.
> - Пересмотр протокола обязателен при: смене host, миграции таймера на другой механизм
>   (anacron, k8s CronJob), повторной деградации GHA ниже 20 schedule runs/день в течение
>   7 дней после перехода (маркер необходимости пересмотра grace/lateness), добавлении
>   второго clock authority.

## 4. Unit/timer/service контракты (implementation-ready)

Файлы в репо: `scripts/deploy/source-refresh-tick.sh`,
`ops/systemd/rr-source-refresh.service`, `ops/systemd/rr-source-refresh.timer` (этот PR —
только файлы в git; установка на host — §7).

### 4.1 `rr-source-refresh.timer`

```ini
[Unit]
Description=Recruiter Radar: hourly source-refresh tick (sole authoritative tick generator)

[Timer]
OnCalendar=*:15:00 UTC
Persistent=true
RandomizedDelaySec=0
AccuracySec=1s
Unit=rr-source-refresh.service

[Install]
WantedBy=timers.target
```

- `OnCalendar=*:15:00 UTC` — ровно 24 fire-события/сутки. На границе
  `slot_id=floor(observed_at − 15min)` это даёт текущий час ровно в :15, т.е. не
  приписывает fire в 00:00 предыдущему UTC-дню.
- `Persistent=true` — service стартует после downtime/reboot, но тик вычисляет
  `slot_id` от фактического времени (§4.4); history не backfill'ится и пропуски
  остаются RED.
- `RandomizedDelaySec=0` — недопустим джиттер: тик обязан стартовать на :15, иначе
  `slot_id` может смениться либо превысить lateness budget.
- Совместимость: Ubuntu 18.04 (systemd 237) поддерживает `OnCalendar ... UTC`,
  `Persistent`, `AccuracySec`. Проверено локально `systemd-analyze calendar '*:15:00 UTC'`
  на systemd 255 (WSL) — форма валидна и для 237.

### 4.2 `rr-source-refresh.service`

```ini
[Unit]
Description=Recruiter Radar: single source-refresh tick (VM authority)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/recruiter-radar
ExecStart=/opt/recruiter-radar/source-refresh-tick.sh
TimeoutStartSec=25min
User=root
Nice=5
# journalctl -u rr-source-refresh.service — единственный host-side лог тика
StandardOutput=journal
StandardError=journal
```

- `Type=oneshot` + systemd default: повторный `start` при активном unit'е — no-op,
  параллельные тики невозможны на уровне systemd (в дополнение к PG advisory lock
  приложения и PK ledger'а — три независимых слоя).
- `TimeoutStartSec=25min` > workflow-бюджета 20 мин:-refresh может быть долгим;
  latenessbudget оценивается по `observed_at`, не по завершению (§2.4).

### 4.3 `source-refresh-tick.sh` (детерминированный payload)

Скрипт (полный текст в репо, `scripts/deploy/source-refresh-tick.sh`):

1. `slot_id = floor((observed_at − 15min) / 1h)` в UTC; при normal fire в :15
   он равен текущему часу, canonical.
2. `observed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)`.
3. `POST /api/cron/source-refresh` c JSON
   `{"slot_id":"…","scheduled_at":"…","observed_at":"…","authority":"vm-systemd"}`;
   route сам читает deploy SHA из `RR_DEPLOY_SHA` runtime'а (не скрипт), атомарно
   claim'ит ledger и затем исполняет refresh (§6) — скрипт не дублирует бизнес-логику.
4. Маппинг HTTP-ответа на exit code: `200/207-green|degraded → 0`, `207-required → 1`,
   `422 → 0` (no_op, так же как GHA workflow), `409 → 0` (duplicate), прочее/timeout → 1.
5. Ноль секретов в argv/env скрипта: `CRON_API_KEY` читается endpoint'ом из runtime
   web-контейнера; скрипт ходит на `127.0.0.1:3000` **внутри** host network namespace
   через `docker compose exec -T web node …` (тот же паттерн, что GHA workflow) —
   наружный порт не открывается.

Защита от «no service manager»: таймер ставится **только** на production host
(Debian/Ubuntu с systemd). Если host когда-либо сменится на контейнерный без systemd —
это событие пересмотра §3, не локальный хак.

### 4.4 `scheduled_at` при Persistent catch-up

systemd не сообщает прямо «за какой пропуск идёт запуск». Скрипт вычисляет
`scheduled_at` только из фактического `slot_id` (начало текущего floor-hour). Если
`Persistent` разбудил unit после долгого downtime, это **не** backfill: исторические
slots не вставляются и будут отсутствовать/RED на close-watermark. Если wake попал в
`slot_id + 15min`, это обычный вовремя стартовавший current-slot; позднее — `red` по
§2.4. Никакой automatic catch-up не может закрыть прошедший slot зелёным.

## 5. Влияние на существующий refresh endpoint

`/api/cron/source-refresh` расширяется, но его текущие auth, effective-failure и
422-семантика сохраняются. Для `authority='vm-systemd'` route обязан валидировать
metadata, выполнить atomic ledger claim (§2.3), при late/duplicate не запускать source
scheduler, а при валидном claim вызвать существующий `runScheduledSourceRefresh()`.
Для `authority='github-manual'` / legacy GHA schedule route выполняет только probe-refresh:
**не** claim'ит ledger и не может изменить day/slot status. PostgreSQL advisory lock всё ещё
сериализует сам scheduler; одновременный probe безопасно получает `deferred`.

## 6. Расширение `/api/cron/source-refresh` — API/migration impact

Отдельная задача @rr-backend (код не входит в этот PR). Контракт:

- Auth: существующий `x-api-key` contract (тот же env-secret, без его передачи в argv).
- Request authoritative VM tick: `{slot_id, scheduled_at, observed_at, authority:'vm-systemd'}`;
  request GHA probe: `{authority:'github-manual'}` либо существующее пустое тело legacy-call.
  Server-side валидация slot_id (`^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$`), canonical UTC и
  authority ∈ `{vm-systemd, github-manual}`. `github-schedule-legacy` нужен лишь для
  исторического import, отдельной migration task, не в этом PR.
- Behavior VM: ledger INSERT (§2.2/§2.3) → только если вставился и не late (§2.4) →
  `runScheduledSourceRefresh()` in-process → маппинг §2.4. Результат пишется отдельным
  append-only result-row `source_refresh_tick_result` (PK `slot_id`) либо в immutable
  `result_jsonb` insert-модель; окончательную физическую форму выбирает @rr-backend, но
  поля контракта не меняются.
- Behavior GHA: refresh permitted only as non-authoritative probe; route response включает
  `authority:'github-manual', authoritative:false`, не создаёт/не закрывает ledger-slot.
- Миграция: новая таблица(ы) append-only, `INSERT`-only grants для app-role, без
  UPDATE/DELETE (§10.2 протокола: целевое состояние БД).

## 7. Ops plan применения (после merge, НЕ сейчас)

Пререквизиты (owner gate @user, после fresh snapshot + pg_dump):

```bash
# 0) Snapshot + dump (existing precedent t_b0503d24)
# 1) Stage files
scp ops/systemd/rr-source-refresh.timer root@HOST:/etc/systemd/system/
scp ops/systemd/rr-source-refresh.service root@HOST:/etc/systemd/system/
scp scripts/deploy/source-refresh-tick.sh root@HOST:/opt/recruiter-radar/source-refresh-tick.sh
# 2) Enable (run on VM as root)
ssh root@HOST 'chmod 0750 /opt/recruiter-radar/source-refresh-tick.sh && systemctl daemon-reload && systemctl enable --now rr-source-refresh.timer'
# 3) Observe one cycle (run on VM as root)
ssh root@HOST 'systemctl list-timers rr-source-refresh.timer --all'
ssh root@HOST 'journalctl -u rr-source-refresh.service --since -2h'
# 4) Only after first GREEN slot: demote GHA schedule
#    (remove `schedule:` block from source-refresh-clock.yml, keep workflow_dispatch) —
#    отдельный PR @rr-support, НЕ part of this branch.
```

Двух-authority интервал (timer уже включён, GHA schedule ещё не удалён): безопасен —
GHA-run не пишет ledger, refresh под advisory lock вернёт `deferred`, gâte ок
(`github-schedule-legacy` в proof-отчёте считается не-authoritative шумом, §1).

### Rollback (полный, без потери данных)

```bash
ssh root@HOST 'systemctl disable --now rr-source-refresh.timer && systemctl stop rr-source-refresh.service 2>/dev/null || true'
ssh root@HOST 'rm /etc/systemd/system/rr-source-refresh.{service,timer} && systemctl daemon-reload'
# ledger-таблица остаётся (append-only evidence), не дропается.
# Возврат GHA schedule: revert «demote GHA» PR — schedule возвращается в main,
# деплой не требуется (workflow only).
```

Частичная деградация (timer жив, endpoint/ledger сломан): тики падают с exit 1 в
journal; день уходит RED по протоколу — это **честный** RED, чинится backend-fix, а не
подгонкой ledger.

## 8. Verification-план (что считается «готово»)

1. `bash -n scripts/deploy/source-refresh-tick.sh` — 0.
2. `systemd-analyze verify` unit+timer на systemd ≥237 — 0 errors (прогнано на 255
   WSL; на host 237 — после stage, до `enable`).
3. Jest suite `source-refresh-vm-tick-authority.test.ts` — зелёный (сам PR).
4. Соседние suites `scheduler-authority-contract`, `source-refresh-clock-semantics`,
   `source-refresh-fail-closed` — не сломаны (этот PR не трогает route/workflow).
5. Dry-run скрипта с mock-endpoint (bash + `nc`/node) — exit-маппинг §4.3 подтверждён.
6. На host (post-gate, §7): первый тик пишет ledger-ряд с `authority=vm-systemd`,
   `journalctl` содержит slot_id, `/api/health` deploy SHA совпадает.

## 9. Границы этого PR

- В репо: amendment-документ (этот файл), tick-скрипт, systemd unit/timer, jest-тесты.
- НЕ в этом PR: миграция ledger-таблицы и route-extension (@rr-backend), удаление GHA
  schedule (@rr-support, отдельный PR), любые изменения на VDS (@rr-ops после gate).
- Не трогаем: production/VDS, secrets/.env, DB writes, `main`, live window counter,
  существующие workflow/route файлы.
