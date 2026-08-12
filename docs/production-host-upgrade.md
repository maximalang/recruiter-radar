# Production host upgrade runbook

**Статус:** план; выполнение migration/cutover не авторизовано.
**Последний read-only inventory:** 2026-08-11.
**Предпочтительный путь:** новый чистый Ubuntu 24.04 LTS host и контролируемое переключение.

## Почему не in-place upgrade

Текущий host работает на Ubuntu 18.04.6 LTS. Standard security maintenance закончился 31 мая 2023 года, а машина не подключена к Ubuntu Pro/ESM. Canonical поддерживает Ubuntu 24.04 LTS стандартными security updates до мая 2029 года.

In-place переход с 18.04 до 24.04 требует последовательных переходов 18.04 → 20.04 → 22.04 → 24.04, нескольких reboot и решений по изменённым config-файлам. Для единственного production host это создаёт больший rollback-риск, чем параллельная сборка нового host.

Официальные источники:

- https://ubuntu.com/security/esm
- https://ubuntu.com/about/release-cycle
- https://documentation.ubuntu.com/server/how-to/software/upgrade-your-release/
- https://documentation.ubuntu.com/release-notes/24.04/

## Зафиксированный inventory

| Область | Состояние 2026-08-11 | Риск / обязательное действие |
| --- | --- | --- |
| OS | Ubuntu 18.04.6 LTS, kernel 4.15.0-213 | Нет standard support; Ubuntu Pro/ESM не подключён |
| Container runtime | Docker 24.0.2, Compose 2.18.1 | Проверить совместимость на target host до копирования данных |
| Reverse proxy | host Caddy 2.7.6, `caddy.service` | Перенести Caddyfile/unit, проверить config и trust boundary |
| Database | `postgres:16-alpine`, PostgreSQL 16.14 | Использовать logical dump/restore; не копировать live volume как единственное средство миграции |
| Filesystem | `/dev/sda1`, 15 GiB, 53% занято | Target должен иметь запас для двух images, dump и restore |
| Compose | services `db`, `web`; volume `recruiter-radar_pg_data` | Воспроизвести имена/ownership и проверить mounts |
| Live image | `recruiter-radar:f85f3dd12bdfa28b420ef0cf0f2bceecc84d9a65` | Exact target image/SHA должен быть зафиксирован до cutover |
| Rollback image | `recruiter-radar:247861527be364c1b5d4ab0a0327979e3171e7a1` и tag `rollback` | Не удалять до завершения post-cutover hold |
| Backups | локальные `recruiter_radar_YYYYMMDD_0100.sql.gz`, 4–11 августа | Off-host copy и restore verification не доказаны |
| Config | `/opt/recruiter-radar/.env`, compose overlays, `/etc/caddy/Caddyfile` | Переносить через защищённый канал; не печатать значения в logs |
| Services | Docker, containerd, Caddy, cron, SSH, unattended-upgrades, Zabbix | Воспроизвести только нужные зависимости; проверить Zabbix отдельно |
| Cron | `run-daily-radar.sh`, `backup-db.sh`, `run-auth-challenge-cleanup.sh` | На target держать disabled до cutover, затем включить без дублирования |
| Firewall / SSH | UFW inactive; root/password login разрешены | Target: default-deny firewall, key-only SSH, запрет root/password после проверки аварийного доступа |

## Stop gates

Нельзя начинать migration или менять DNS, пока не выполнены все условия:

1. Есть отдельное явное разрешение на production migration и согласованное окно.
2. Выбран target provider/host и подтверждены CPU, RAM, disk, IPv4/IPv6 и rescue-console access.
3. Создан свежий encrypted off-host backup; checksum сохранён отдельно.
4. Тот же backup успешно восстановлен в disposable PostgreSQL 16 и прошёл smoke/read-only consistency checks.
5. Зафиксированы current deployed SHA, rollback SHA, DNS TTL и rollback owner.
6. На target проверены Docker/Compose, Caddy, firewall, SSH, clock/NTP и monitoring.
7. Все application checks зелёные для exact image/SHA, который будет развернут.
8. Старый host не изменяется и остаётся rollback target до окончания hold period.

Любая ошибка backup, restore, migration, health, TLS или data comparison останавливает cutover. Нельзя продолжать с ослабленными проверками.

## 1. Backup и restore verification

До окна миграции:

1. Остановить только cron, который создаёт новые product writes; web пока остаётся доступным.
2. Создать свежий PostgreSQL 16 logical dump с владельцами/ACL в согласованном формате и gzip-сжатием.
3. Сохранить SHA-256 checksum и metadata: source host, database version, start/end UTC, row-count summary.
4. Скопировать dump и необходимые config-файлы в encrypted off-host storage. `.env` не добавлять в git и не передавать через CI artifacts.
5. Восстановить dump в новую disposable database PostgreSQL 16. Не использовать `DROP ... CASCADE` и не направлять restore в production database.
6. Проверить:
   - restore завершился без ошибок;
   - migrations table соответствует exact application SHA;
   - ключевые таблицы доступны;
   - counts по users/workspaces/client profiles/opportunities/entitlements/payment events/digest runs совпадают с source snapshot;
   - tenant-scope выборки не смешивают workspace;
   - приложение стартует на restored DB и `/api/health` возвращает 200.
7. Удалять disposable database можно только после записи результата и проверки exact имени target.

Restore drill является обязательным доказательством. Наличие `.sql.gz` на том же host недостаточно.

## 2. Подготовка нового Ubuntu 24.04 LTS host

1. Установить все security updates и reboot до настройки приложения.
2. Создать отдельного non-root deploy user с key-only SSH.
3. Сначала проверить вторую активную SSH-сессию и rescue console, затем отключить password authentication и root login.
4. Включить firewall default-deny; разрешить только SSH с согласованных адресов и публичные 80/443. Database port наружу не публиковать.
5. Установить поддерживаемые Docker Engine и Compose plugin из официального репозитория Docker; зафиксировать версии в migration receipt.
6. Установить Caddy и проверить `caddy validate` до запуска service.
7. Включить unattended security updates и monitoring. Проверить clock synchronization.
8. Создать `/opt/recruiter-radar` с минимальными ownership/permissions. Secret-файлы должны быть доступны только deploy/runtime user.

## 3. Docker и application image

1. Зафиксировать exact application SHA и immutable image digest.
2. Передать image на target или собрать из exact SHA в доверенном CI; не использовать плавающий source checkout.
3. Проверить digest до `docker load`/pull.
4. Развернуть compose с теми же service names (`db`, `web`) и отдельным новым volume.
5. Не запускать customer-facing cron и delivery до завершения restore и smoke.
6. Сохранить предыдущий production SHA как явный rollback target; не выполнять broad image prune.

## 4. PostgreSQL data migration

Предпочтителен logical dump/restore в новый PostgreSQL 16 container:

1. Выполнить подтверждённый restore procedure на target.
2. Запустить application migration mechanism для exact SHA один раз.
3. Повторить migration-current check и key table counts.
4. Выполнить read-only tenant checks и entitlement/payment ledger consistency checks.
5. Если downtime window допускает writes до последнего момента, перед cutover включить maintenance/write freeze, создать final delta/full dump и повторить restore. Нельзя переключать DNS на устаревший snapshot.

Raw copy Docker volume допустима только как дополнительная аварийная копия при остановленном PostgreSQL и совпадающем runtime; она не заменяет logical restore proof.

## 5. Caddy, DNS и TLS

1. Перенести Caddy config без секретов в logs; сохранить upstream trust boundary.
2. Проверить config локально и поднять target на временном hostname или hosts-file override.
3. Проверить HTTP→HTTPS, certificate issuance, HSTS/headers, real client IP и доступность `/api/health`.
4. Снизить DNS TTL заранее, не в момент cutover.
5. Перед переключением записать старые DNS values и команду/владельца rollback.
6. После переключения проверить DNS с нескольких resolvers и TLS certificate chain.

## 6. Cron, systemd и delivery

На новом host должны быть воспроизведены и проверены:

- `caddy.service`, Docker/containerd и monitoring;
- daily radar: `run-daily-radar.sh` в 03:00 server time;
- database backup: `backup-db.sh` в 01:00;
- auth challenge cleanup: `run-auth-challenge-cleanup.sh` в 02:15.

До DNS cutover cron остаётся disabled. После cutover сначала убедиться, что cron на старом host остановлен, и только затем включить target, чтобы исключить двойные radar/delivery/cleanup runs.

## 7. Cutover smoke test

Минимальный smoke после переключения:

1. container state `running/healthy` и exact image SHA/digest;
2. public `/api/health` = 200, DB = `ok`, Redis не в состоянии `error`;
3. migrations current и protected readiness доступна только с валидным operator key;
4. landing, brand, favicons и dry-run landing event;
5. login/magic-link request без account enumeration;
6. authenticated `/leads`, lead detail, `/opportunities`, Evidence Radar desktop/mobile;
7. критические API routes возвращают ожидаемые auth/feature-gate статусы;
8. cron пока disabled; затем один controlled dry-run/healthcheck без массовой доставки;
9. logs не содержат новых errors и secrets;
10. backup job на target создаёт файл, off-host copy и checksum.

## 8. Rollback

Rollback запускается при любом из условий: health != 200, migration mismatch, data-count mismatch, auth failure, TLS failure, tenant boundary anomaly или невозможность безопасно запустить cron.

Порядок:

1. Не выполнять новые migrations/writes на неисправном target.
2. Остановить target cron и delivery.
3. Вернуть DNS на зафиксированные старые values либо восстановить старый upstream route.
4. Убедиться, что старый host всё ещё использует сохранённый healthy image и исходный database volume.
5. Включить старый cron только после подтверждения, что target cron остановлен.
6. Проверить public health, authenticated smoke и отсутствие двойной доставки.
7. Сохранить target, logs и migration receipt для анализа; не удалять данные до решения владельца.

Если после cutover target принял новые writes, простой DNS rollback может потерять данные. В этом случае остановить writes и выполнить отдельный reconciliation plan; не копировать данные обратно импровизированно.

## Downtime expectation и завершение

Планировать 30–60 минут write freeze для final dump/restore, checks и DNS cutover; фактическое окно уточняется после измеренного restore drill. Старый host, rollback image и backup сохраняются минимум на согласованный hold period.

Миграция считается завершённой только когда exact deployed SHA, public health, authenticated smoke, cron single-owner state, first target backup/off-host copy и monitoring подтверждены и записаны. Удаление старого host — отдельное явно разрешённое действие.
