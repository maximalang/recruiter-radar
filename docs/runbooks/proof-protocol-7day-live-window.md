# Proof Protocol: 7-Day Live Window Sources

Status: draft v2 · 2026-08-26 · Task t_4d6cec22 (feeds t_610629e0) · Branch `codex/source-refresh-clock-protocol`

Цель — определить, **какое доказательство** отличает источник с
`expectedRefreshIntervalMs = 7 * DAY` («источник жив») от источника, который лишь
структурно готов («код есть, fixtures зелёные, миграции применены — но живости нет»).
Протокол фиксирует: объект протокола; определение живости; механическую классификацию;
статусную таксономию прогона и дня; fail-closed семантику; границы допустимой деградации;
схему immutable evidence-снапшота; правила 7-дневного окна; хранение и retention.
Всё выведено из приложения и его канона (`CLAUDE.md`, `AGENTS.md`,
`apps/web/lib/sources/source-schedules.ts`, `packages/db/source-policy.json`,
миграция `20260814030000_add_source_temporal_health.sql`,
`apps/web/app/api/cron/source-refresh/route.ts`, `.github/workflows/source-refresh-clock.yml`),
не из внешней оркестрации.

Пункт(ы) приёмки задачи, закрываемые разделами: (a) → §4–5; (b) → §6; (c) → §7;
(d) → §8; (e) → §9; (f) → §10.

## 1. Объект протокола

Целевые источники — все записи `SOURCE_SCHEDULES` с интервалом ровно `7 * DAY`
(шесть из 28 записей карты):

| Source | Host key | Приоритет | Confidence | leadEligibility | promotionStatus |
| --- | --- | --- | --- | --- | --- |
| egrul-fns | snapshot:fns | P1 | 0.90 | enrichment-only | never-lead-originating |
| transparent-business-fns | snapshot:fns | P1 | 0.86 | enrichment-only | never-lead-originating |
| fns-open-data | snapshot:fns | P3 | 0.88 | context-only | never-lead-originating |
| cbr-registry | cbr.ru | P3 | 0.90 | context-only | never-lead-originating |
| rosstat-open-data | snapshot:rosstat | P3 | 0.66 | context-only | never-lead-originating |
| rospatent-open-data | snapshot:rospatent | P3 | 0.66 | context-only | never-lead-originating |

Ни один из шести не является lead-originating: для digest-пайплайна они ценны как
enrichment (уточнение identity организации) и context (контекстные сигналы).
Это не снижает требования к живости: устаревший enrichment тиражирует ошибки в
lead cards сильнее, чем отсутствующий.

Риск корреляции: три источника сидят на одном hostKey `snapshot:fns`. Один инцидент
провайдера/снапшота бьёт по трём окнам одновременно, поэтому их live-пруфы нельзя
считать независимыми свидетельствами — при отчёте фиксировать общий hostKey.

## 2. Определение «источник жив»

Источник считается живым в своём окне, когда одновременно:

1. **Due-решение работает**: планировщик (`source-refresh-clock.yml`, cron `45 * * * *`;
   PostgreSQL scheduler state решает, какой источник due) реально выбирает источник,
   когда подошло окно. Часовой cron — частота проверки, НЕ интервал источника.
2. **Fetch успешен**: последняя попытка завершилась исходом `success` не позже чем
   `now <= last_success + 7d + grace`.
3. **Нормализация успешна**: данные дошли до accepted records, а не только скачались
   (`records_accepted > 0` либо осмысленный `expected-zero`; сырой fetch без нормализации
   живостью не считается).
4. **Обновляемость подтверждена**: содержимое источника действительно меняется между
   запусками (непустая свежая дельта против предыдущего наблюдения) — иначе «success»
   может маскировать мёртвый снапшот с неизменным файлом.

`grace` — операционный запас на retry/backoff, по умолчанию равен одному суточному циклу
пересчёта digest'а. Итоговое правило устаревания:
`stale := (now - last_successful_normalization_at) > INTERVAL '7 days' + grace`.

Единственный авторитетный источник фактов о живости — таблицы БД
`source_run_observations` (журнал попыток с outcome ∈ success/blocked/rate_limited/failure),
`source_health_state` (агрегат: last_attempt_at, last_successful_fetch_at,
last_successful_normalization_at, consecutive_failures, …) и смежные
`source_temporal_*`. Ответ JSON `/api/cron/source-refresh` — вторичное свидетельство,
оно страдает временностью окна запроса и текущим отсутствием полей критичности (§11).

## 3. Кольца доказательств (L1 → L3)

**L1 — контрактное (fixtures).** Матрица fixture-тестов ответа/классификации:
200 (все успех), 207 optional-degradation, 207 required-failure, 207 unknown-source,
422 нет активных профилей, malformed JSON, missing details, legacy payload.
Ограничение: fixtures доказывают обработку форм, а не живость внешнего мира.

**L2 — наблюдаемое состояние (БД).** Повторяемый SQL-осмотр `source_run_observations` /
`source_health_state`. Минимальный состав запроса на каждый источник (реквизиты
зафиксированы, чтобы отчёты были сопоставимы во времени):

```sql
-- L2 lineage v3 (B7): executable against migration
-- 20260814030000_add_source_temporal_health.sql. `records_accepted` is the only
-- normalization counter; outcome is constrained to success/blocked/rate_limited/failure.
WITH expected(source_id) AS (
  VALUES ('egrul-fns'),
         ('transparent-business-fns'),
         ('fns-open-data'),
         ('cbr-registry'),
         ('rosstat-open-data'),
         ('rospatent-open-data')
),
observed AS (
  SELECT
    source_id,
    COUNT(*) FILTER (
      WHERE completed_at > NOW() - INTERVAL '7 days' - INTERVAL '1 day') AS attempts_8d,
    COUNT(*) FILTER (
      WHERE outcome = 'success'
        AND records_accepted > 0
        AND completed_at > NOW() - INTERVAL '7 days' - INTERVAL '1 day') AS accepted_success_8d,
    COUNT(*) FILTER (
      WHERE outcome = 'success'
        AND records_fetched = 0
        AND records_accepted = 0
        AND completed_at > NOW() - INTERVAL '7 days' - INTERVAL '1 day') AS zero_success_8d,
    COUNT(*) FILTER (
      WHERE outcome = 'blocked'
        AND completed_at > NOW() - INTERVAL '7 days' - INTERVAL '1 day') AS blocked_8d,
    COUNT(*) FILTER (
      WHERE outcome = 'rate_limited'
        AND completed_at > NOW() - INTERVAL '7 days' - INTERVAL '1 day') AS rate_limited_8d,
    MAX(completed_at) FILTER (WHERE outcome = 'success') AS last_success,
    MAX(completed_at) FILTER (WHERE outcome = 'success' AND records_accepted > 0) AS last_accepted,
    COALESCE(SUM(duplicate_records) FILTER (
      WHERE completed_at > NOW() - INTERVAL '7 days' - INTERVAL '1 day'), 0) AS dupes_8d
  FROM source_run_observations
  GROUP BY source_id
),
health AS (
  SELECT source_id, last_successful_normalization_at
  FROM source_health_state
)
SELECT
  e.source_id,
  COALESCE(o.attempts_8d, 0)       AS attempts_8d,
  COALESCE(o.accepted_success_8d, 0) AS accepted_success_8d,
  COALESCE(o.zero_success_8d, 0)   AS zero_success_8d,
  COALESCE(o.blocked_8d, 0)        AS blocked_8d,
  COALESCE(o.rate_limited_8d, 0)   AS rate_limited_8d,
  o.last_success,
  o.last_accepted,
  h.last_successful_normalization_at,
  COALESCE(o.dupes_8d, 0)          AS dupes_8d,
  CASE
    WHEN o.source_id IS NULL THEN 'MISSING_SOURCE'
    WHEN COALESCE(o.accepted_success_8d, 0) > 0
      AND o.last_accepted >= NOW() - INTERVAL '7 days' - INTERVAL '1 day'
      THEN 'LINEAGE_OK'
    ELSE 'NO_ACCEPTED_EVIDENCE'
  END AS lineage_verdict
FROM expected e
LEFT JOIN observed o USING (source_id)
LEFT JOIN health h USING (source_id)
ORDER BY e.source_id;
-- Pass criterion (fail closed): every expected row must have
--   lineage_verdict = LINEAGE_OK,
--   accepted_success_8d > 0, and last_accepted >= NOW() - 8 days.
-- `zero_success_8d` is diagnostic only: this DB schema has no `expected-zero` outcome
-- or upstream identity columns, so L2 cannot promote a zero stream to LINEAGE_OK.
-- MISSING_SOURCE is a hard failure, not an empty result.
```

**L3 — live-пруф (реальная среда).** Контролируемый прогон против production:
HTTP-вызов scheduled refresh по продуктивному пути планировщика, проверка логов
`source_refresh.run/partial/failed`, последующая сверка строк в
`source_run_observations`. Только L3 переводит флаг «live window подтверждён»;
L1/L2 самостоятельно не доказывают живость.

## 4. Механическая классификация required / optional / unknown

Классификация выводится только из канонического `packages/db/source-policy.json`, без ручных
исключений. Правило (совпадает с применяемым кодом):

```
required(source) :=
    (promotionStatus == 'digest-allowed'
     AND leadEligibility IN ('digest-lead-originating', 'confidence-gated-evidence'))
 OR sourceId == 'egrul-fns'   -- обязательная identity-enrichment политика проекта
unknown(source) := отсутствие записи в policy => fail-closed => treated as required
иначе optional
```

Механический прогон правила по всем 27 источникам policy (вывод воспроизводим,
команда — обычный перебор `Object.entries(packages/db/source-policy.json)`):

```text
required(11): ashby, career-pages, egrul-fns, greenhouse, hh, lever, rabota-rossii,
              recruitee, smartrecruiters, superjob, workable
optional(16): cbr-registry, company-newsrooms, company-site, fedresurs, fns-open-data,
              funding-business-signals, github-company-org, government-procurement,
              habr-career, industry-media, linkedin-company-pages, rospatent-open-data,
              rosstat-open-data, telegram-company-channels, transparent-business-fns,
              youtube-company-channels
```

Для целевой шестёрки это даёт:

| Source | Классификация | Основание |
| --- | --- | --- |
| egrul-fns | **required** | специальное правило mandatory identity enrichment |
| transparent-business-fns | optional | enrichment-only вне спец-правила |
| fns-open-data | optional | context-only |
| cbr-registry | optional | context-only |
| rosstat-open-data | optional | context-only |
| rospatent-open-data | optional | context-only |

Неизвестные будущие 7-day источники fail-closed = required/delivery-impacting.
Изменение класса возможно только коммитом в `source-policy.json` — протокол запрещает
подменять классификацию аргументами «но он обычно стабильный». Датировка выгрузки
классификации (коммит + дата policy) входит в состав дневного снапшота через
`policy_sha256` (§8), поэтому дрейф классификации внутри окна всегда обнаружим.

## 5. Статусная таксономия: прогон источника и день

(a) Таксономия двух уровней. Промежуточных цветов нет.

**Уровень прогона (per source run)** — значения `green | red | unknown`:

| Статус | Условие | Типичные исходы |
| --- | --- | --- |
| `green` | данные верифицированно дошли до пайплайна, причём B2-гейт свежести пройден: датируемая upstream identity (content_hash + `upstream_updated_at` в горизонте `[D−(7d+1d), D]`) и принятый delta verdict | `ingested`, `ingested-with-duplicates`; `idempotent-replay` при подтверждённой свежести; `expected-zero` — только если контракт источника явно декларирует «может быть законно пустым» и детекция это подтвердила. `success` без свежей dated identity или без delta verdict — НЕ green (B2 v4) |
| `red` | верифицированный провал прогона | `failed`, `blocked`, `missing-summary`, `invalid-summary`, `unexpected-zero`, `normalization-zero`, `ingestion-zero`, `rate-limited` у required/unknown; `green-without-fresh-upstream-identity` (B2 v4) |
| `unknown` | вердикт установить нельзя | отсутствующая строка наблюдения за плановый запуск, `deferred` за пределами оверлап-бюджета, `credential-gated`, malformed/несовместимый payload, ответ без ожидаемых полей |

Обязательные атрибуты каждого прогона в evidence: `outcome`, `records_fetched`,
`records_accepted`, `duplicate_records`, `latency_ms`, `error_code` (только коды, не тела).

**Уровень календарного дня (UTC-день покрытия)** — значения `GREEN_DAY | RED_DAY`:

- `GREEN_DAY`: все required-источники зелёные И полная комплектность запусков
  (нет missing/partial) И деградации optional в пределах границ §7.
- `RED_DAY`: хотя бы одно из — required-источник красный или unknown; пропущенный или
  неполный запуск любого из шести источников; превышение любой границы §7.

Жёлтого/частичного статуса дня нет намеренно: смешанный день — это RED_DAY.

## 6. Fail-closed семантика обязательных источников

(b) Правила, не допускающие тихих пропусков:

1. Required-источник вернул `red` ИЛИ `unknown` ⇒ день автоматически `RED_DAY`.
   Никакой бюджет, ретрай-логика или «источник обычно стабильный» этого не отменяют.
2. Пропущенный (missing) или неполный (partial) запуск required-источника в течение
   дня эквивалентен `unknown` ⇒ тот же результат: `RED_DAY`.
3. Неизвестность нельзя конвертировать в зелёность ожиданием: неизвестность живёт
   до появления фактического исхода прогона в evidence того же дня.
4. `deferred` — штатный оверлап планировщика, НЕ провал и НЕ зелёность. Если источник
   остаётся `deferred` больше одного пересчётного цикла, он переводится в `unknown`
   (и для required — в `RED_DAY` согласно пункту 1).
5. Любая попытка пометить required-источник зелёным без строки `green`-прогона в
   evidence дня — нарушение протокола, а не вопрос интерпретации.

## 7. Ограниченная деградация optional с жёсткими границами

(c) Деградировать могут только optional-источники целевой шестёрки (все, кроме
egrul-fns) и только вторичные поля их контекстного вклада (обогащение контекстных
сигналов digest'а). Never degradable ни при каких условиях: поля identity
(legal_entity_name, inn/ogrn), evidence_bundle, confidence gate, FIUR-скоры,
доставка digest'а. Причины:

| Source | Допустимо деградировать | Недопустимо |
| --- | --- | --- |
| transparent-business-fns | свежесть enrichment-флагов прозрачности | identity-поля, P1-доказательства |
| fns-open-data, cbr-registry, rosstat-open-data, rospatent-open-data | контекстные сигналы уровня «есть/нет, сколько» | всё, что попадает в evidence_bundle или влияет на confidence |

Числовые границы (hard bounds, константы протокола; инструментирование читает их
именно как числа, без «разумных умолчаний по месту»):

```text
MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY = 2
    # максимум optional-источников со статусом red/unknown за один UTC-день;
    # шестёрка: egrul-fns required; среди оставшихся ПЯТИ optional при двух
    # деградировавших остаются минимум 3 здоровых optional (граница «2-of-5»);
    # у required своя собственная семантика красного дня, бюджетом это не покрывается
MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE = 2
    # один и тот же optional-источник может быть не-зелёным максимум 2 UTC-дня подряд;
    # третий день подряд => день автоматически RED_DAY
```

Превышение любой границы конвертирует день в `RED_DAY` и порождает запись в
`degradation_events[]` снапшота (§8). Границы применяются после fail-closed-правил §6:
они дают пространство манёвра только optional, никогда required.

## 8. Схема дневного immutable-снапшота покрытия

(d) Каждый UTC-день получает ровно один снапшот `source-refresh-coverage`, версия
схемы 2:

```json
{
  "schema_version": 2,
  "evidence_type": "source-refresh-coverage",
  "evidence_day_utc": "2026-08-26",
  "produced_at": "2026-08-27T00:10:00.000Z",
  "producer": {
    "repo_sha": "<ПОЛНЫЙ 40-hex git SHA запускающего деплоя>",
    "workflow_run_url": "https://github.com/<org>/<repo>/actions/runs/<run_id>",
    "policy_sha256": "<sha256(packages/db/source-policy.json)>",
    "schedules_sha256": "<sha256(apps/web/lib/sources/source-schedules.ts)>"
  },
  "window_days": 7,
  "runs": [
    {
      "source_id": "egrul-fns",
      "criticality": "required",
      "status": "green",
      "outcome": "ingested",
      "records_fetched": 120,
      "records_accepted": 118,
      "duplicate_records": 2,
      "error_code": null,
      "upstream_identity": {"content_hash": "<16..64hex>", "version_id": null, "upstream_updated_at": null},
      "close_condition": {"awaited_launch_after": "...", "satisfied_by_run_id": "...", "satisfied_at": "..."}
    }
  ],
  "degradation_events": [
    {
      "source_id": "rosstat-open-data",
      "criticality": "optional",
      "kind": "unknown",
      "consecutive_degraded_days": 1,
      "within_bounds": true
    }
  ],
  "bounds_applied": {
    "MAX_DEGRADED_OPTIONAL_SOURCES_PER_DAY": 2,
    "MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE": 2
  },
  "snapshot_hash": "<sha256 канонического JSON без самого поля snapshot_hash>",
  "predecessor_snapshot_hash": "<snapshot_hash предыдущего дня окна | null у genesis>",
  "tick_partitioning": {"rule": "floor-to-hour tick slot", "grace_ms": 900000, "ticks_observed": ["..."]},
  "day_status": "GREEN_DAY",
  "immutability": "append-only; изменения запрещены, исправления — новым файлом-заменой со ссылкой"
}
```

Правила схемы:

- `runs[]` обязан содержать все шесть источников; отсутствие элемента — дефект сборки
  снапшота, а не просто «нет данных»: такой снапшот не публикуется, день считается
  покрытым только полноценным файлом.
- `observation_row_ids` выведен из употребления: реальная связь с БД идёт через
  `upstream_identity` + `close_condition.satisfied_by_run_id` (§17.3); поле оставлено
  пустым массивом только для совместимости схемы v2 и не проверяется гейтом.
- Все счётчики ограниченные: id источников, статусы, исходы, числа, коды ошибок.
  Никогда — сырые provider payload'ы, персональные контакты, креды, тела upstream-ошибок.
- Связь с БД (v2): lineage проверяется SQL-ом L2 по §3 (`expected` VALUES CTE + LEFT JOIN),
  а не через `observation_row_ids`.
- `config_version_hash` фиксирует конфигурацию дня; два дня с разным hash внутри окна
  не блокируют окно, но об этом обязана быть запись в отчёте окна (детерминированность
  окон при смене версии конфигурации проверяется вручную @rr-support).
- Устаревшее поле `config_version_hash` заменено связкой `snapshot_hash` +
  `predecessor_snapshot_hash` + producer-поля (§17.4): хеш цепочка и identity деплоя
  дают более сильную гарантию, чем один агрегатный хеш конфигурации.

Снапшоты генерируются отдельным инструментальным pipeline-кодом (не руками), но текущий
workflow `source-refresh-clock.yml` сам захватывает и загружает только один run-artifact;
он НЕ вызывает collector/builder/checker и НЕ публикует дневной snapshot. После накопления
полного набора запусков операторский/следующий pipeline обязан вызвать collector, затем
`build-coverage-snapshot.mjs`, затем `check-coverage-window.mjs`; без этого live window не
считается закрытым. Коллектор читает скачанные CI-логи (не `source_run_observations` напрямую),
builder вычисляет статусы §5 и границы §7, checker механически закрывает окно.

## 9. Правила 7-дневного окна

(e) Окно считается по **семи последовательным UTC-календарным датам** (граница дня —
00:00Z, без смещений на таймзону оператора):

1. Засчитывается только evidence из **live/production**: деплой, который реально
   вызывался продовым планировщиком по пути `.github/workflows/source-refresh-clock.yml`
   → `/api/cron/source-refresh`. Зелёность структурных/тестовых сред (локальные тесты,
   CI, staging-replay, fixture-прогоны L1, SQL-осмотр дев-базы) **не засчитывается**
   ни частично, ни полностью.
2. Каждая из 7 дат обязана иметь опубликованный immutable-снапшот. Отсутствующий файл =
   дыра = автоматический `RED_DAY` — окна «с продолжением со следующего дня» нет.
3. Отсутствующий или неполный запуск любого источника в любую из 7 дат = `RED_DAY`
   этой даты (совпадает с §6.2 и таксономией unknown).
4. Окно проходит тогда и только тогда, когда последние 7 последовательных дней — все
   `GREEN_DAY`. Одна `RED_DAY`-дата выбраковывает всю кандидатную двойку окон, куда она
   входит; отсчёт нового окна начинается со следующей полной зелёной последовательности.
5. Механическая формула проверки: гейт `scripts/check-coverage-window.mjs` v2 берёт
   7 дат окна и по каждой проверяет (§17.4–17.5):

   - published snapshot `<D>.json` существует, schema_version=2, producer identity валиден,
     `snapshot_hash` воспроизводится при пересчёте, `predecessor_snapshot_hash` совпадает
     с предыдущим опубликованным днём цепочки;
   - day_status == GREEN_DAY, границы §7 внутри bound'ов из `bounds_applied`, §16
     close_condition закрыт для всех шести слотов.
   Никакого человеческого «скорее всего ок» между файлами. Unsigned/hand-made snapshot
   (нет producer, нет хеша, сломанная цепочка) — fail-closed NOT_READY, не повод для ручной
   интерпретации.
6. До выполнения внешней верификации планировщика действует прежняя граница
   `{productionScheduled:false, scheduleVerification:"external-after-merge"}`: даже 7
   зелёных дней после merge не объявляются proof'ом, пока внешний чек не исполнен.

## 10. Хранение evidence и retention

(f) Место хранения и формат жизни evidence:

1. **Первичное хранилище — репозиторий**, append-only файлы:
   `docs/evidence/source-refresh-coverage/YYYY/MM/DD.json` — один файл на UTC-день,
   схема §8. Файл создаётся единожды и впоследствии не редактируется; исправление
   возможно только новым файлом `<date>.superseded-by-<seq>.json`, который ссылается
   на оригинал и объясняет причину замены; оба остаются в истории git навсегда.
2. **Дублирующий слой — БД (цель, не факт текущего состояния):** append-only таблица
   вида `source_refresh_coverage_daily` (PK/UNIQUE `evidence_day_utc`, INSERT-only
   гранты, без UPDATE/DELETE). Появление миграции — отдельная задача backend'а; до неё
   единственный авторитетный слой — файлы в репозитории + сырые строки
   `source_run_observations` в БД.
3. **Retention**: детальные дневные файлы хранятся минимум 90 дней; далее допускаются
   месячные rollup'ы `YYYY-MM.json` (только счётчики и day_status по дням) с хранением
   минимум 365 дней. Сырые строки `source_run_observations` подчиняются общей
   retention-политике продукта (@rr-ops владеет бэкапами по прецеденту t_b0503d24);
   удаление coverage-файлов из git-history недопустимо независимо от age.
4. Доступ: только чтение для всех ролей; запись файлов — только pipeline-коллектор
   через бэкенд; никаких ручных правок (даже косметических) post-publication.

## 11. Известный разрыв контракта route ↔ классификация

Текущий `apps/web/app/api/cron/source-refresh/route.ts` отдаёт summary
(total/succeeded/failed/deferred/credentialGated/rateLimited/durationMs) и статус
200/207 исключительно по булеву `r.success`; поля per-result `criticality`,
`failedRequired`, `failedOptional`, `deliveryImpactingFailure` **не возвращаются**,
хотя целевые контракты требуют их. Следствие для этого протокола:

- До внедрения полей критичности HTTP-код сам по себе не может подтвердить/опровергнуть
  живость обязательного источника: `207` обязан разбираться по составу failed results.
- Протокол фиксирует целевое состояние: partial-ответ обязан нести per-result criticality
  и `deliveryImpactingFailure`, чтобы планировщик мог выходить 0 только при
  `deliveryImpactingFailure === false`. Внедрение полей — отдельная задача, не часть
  этого документа.

## 12. Правила не-манипуляции статусами

1. Не делать `207` зелёным только потому, что он присутствует в allowed-status массиве
   или бюджет отказов ненулевой. Разрешение partial — только если failing-множество
   состоит из optional и укладывается в границы §7.
2. Unknown/malformed/no-details ⇒ non-zero exit и фиксация инцидента, не тихий skip.
3. Fixture-набор никогда не предъявляется как proof live readiness / real-DB repeat ingest /
   multi-day stability. Наличие зелёных тестов не обнуляет список блокеров §13.
4. Time-dependent проверки инжектируют фиксированные часы; никаких решений по wall-clock.
5. Ограниченное логирование: только счётчики, source id, outcome, criticality, безопасные
   причины. Никогда — сырые payload провайдера, персональные контакты, креды, тела upstream-ошибок.
6. Граница готовности не переписывается задним числом: пока внешний scheduleVerification
   не выполнен, остаётся
   `{repositoryReady:true, deploymentReady:true, runtimeVerified:true, productionScheduled:false,
   scheduleAuthority:"github-actions", scheduleVerification:"external-after-merge"}`.
7. Post-publication правки evidence-снапшотов запрещены; единственный путь —
   superseded-file механика §10.1 с сохранением обеих версий.
8. Rate-limited у required/unknown = delivery-impacting; у optional — наблюдаемое, но
   не блокирующее событие.

## 13. Текущие непокрытые блокеры (честный остаток)

- **Live-пруфы L3 отсутствуют/устарели**: подтверждающие артефакты датируются
  началом месяца; ни один из шести источников не имеет свежего контрольного
  цикла «due → fetch → normalize → observation-row» в проде.
- **Реальный `DATABASE_URL` недоступен из CI/dev**: SQL-кольцо L2 исполнимо только на
  среде оператора (@rr-ops). Отсутствие возможности повторить repeat-ingest на реальной
  БД — блокер, не деталь.
- **Dedupe-метрики без сигнала**: нулевые duplicate_count в fixtures не доказывают работу
  entity resolution на потоке. Первый настоящий повторный снапшот даст первые ненулевые
  значения — их надо сохранить как baseline.
- **Multi-day история отсутствует** для новых snapshot-источников: окно 7 дней
  содержательно проверяется только второй-третьей неделей эксплуатации. До этого статус
  «окно соблюдено» не проставляется и не заявляется ни в одном отчёте.
- **Коллектор снапшотов не реализован** в приложении; до него evidence собирается
  вручную по шаблону §14 с тем же строгим составом полей.
- **Коррелированный hostKey snapshot:fns** (§1): единичный инцидент способен одновременно
  оставить три источника без обновления; в алерты закладывать групповую проверку.

## 14. Шаблон отчёта живости (per source)

```
source: <id>
classification: required|optional     # вывод из source-policy.json, дата выгрузки
window_days: 7                        # из source-schedules.ts
L1 fixtures: pass|fail               # команда + exit code
L2 observations: attempts_7d=N, success_7d=M, last_success=<ts>, dupes_7d=K
L3 live proof: date, environment, transcript ref, log event id(s)
verdict: live | stale | blocked      # stale/blocked требует причины и owner
```

Вердикт `live` допустим только при `L1 pass ∧ L2 pass ∧ L3 pass`. Любое использование
слова «живой» в отчётах к внешним стейкхолдерам без полного набора колец — нарушение.

## 15. Ответственность и пересмотр

- Данные L2/L3 собирает @rr-ops по запросу @rr-support; решение о снятии блокеров принимает
  @rr-support. Изменения самого контракта (route-поля критичности, коллекция снапшотов,
  append-only таблица) ведёт backend отдельными задачами.
- Протокол пересматривается при любом из событий: новый 7-day источник; изменение семантики
  outcomes; изменение расписаний часов; появление второго scheduler-authority; изменение
  схем `source_run_observations` / `source_health_state`.

## 16. Момент фиксации снапшота: только после следующего успешного прогона

(g) Proof-окно источника не может быть «закрыто» в момент последнего успешного прогона,
потому что живость — это **подтверждаемая обновляемость** (§2.4): следующий плановый
прогон обязан состояться и показать фактический исход. До этого момента день наблюдения
остаётся наблюдением, а не evidence дня окна.

Механическое правило (без ручных исключений):

```text
для каждого источника s шестёрки день D закрывается только при существовании
последующего фактического запуска, содержащего s с исходом ≠ deferred:
    run_started_at(launch) > last_run_started_at(D)          # строго позже последнего прогона дня
  AND row(s, launch) != 'deferred'                           # deferred не считается исходом (§6.4)

снапшот дня D публикуется коллектором только когда
    close_condition.satisfied_by_run_id != null              # для КАЖДОГО из шести слотов
иначе в репозиторий попадает только черновик <day>.pending.json,
не учитываемый окном §9.5 до появления закрывающих прогонов.
```

Следствия:

1. Снапшот для дня `D` **запрещено публиковать до** наступления первого последующего
   исходного прогона по каждому из шести источников — даже если сам день `D` прошёл
   успешно. Инструмент коллектора в этом состоянии пишет только черновик
   `<day>.pending.json` и отказывается публиковать иммутабельный файл.
2. Промежуточный статус такого дня в отчётах окна — не `GREEN_DAY` и не `RED_DAY`,
   а явный `PENDING_CLOSE` со ссылкой на awaited-launch timestamp; в окно §9 он
   не засчитывается ни как зелёный, ни как красный до закрытия.
3. Если следующий плановый запуск после `D` дал `red`/`unknown` для какого-либо
   источника шестёрки, это **не переигрывает** день `D` задним числом (§12.7):
   день `D` закрывается по своему собственному составу исходов, а неудача
   последующего прогона порождает свой собственный `RED_DAY`.
4. Правило устраняет класс манипуляции «прогнали вручную сегодня → объявили неделю
   живости задним числом»: окно закрывается только реальной последовательностью
   запусков, наблюдаемых планировщиком, а не одним контрольным прогоном.
5. Отчётность: в каждом снапшоте поле `close_condition` фиксирует
   `{awaited_launch_after, satisfied_by_run_id|null, satisfied_at|null}` для каждого слота
   `runs[]`; механический гейт окна §9.5 проверяет их перед подсчётом зелёных дней.

Инструментальная поддержка правила: `scripts/build-coverage-snapshot.mjs` отказывается
писать снапшот при невыполненном условии покрытия (b2/b3-требование задачи t_06de2f59).

## 17. Протокол v2: due-каденция, tick ledger, identity-контракт и provenance

Закрытие blocker-review PR #240. Каждое правило инструментировано; номера сценариев
регрессионных тестов — из §18.

### 17.1 Due/not-due решается scheduler-evidence, а не отсутствием строки (B1)

1. Источник без фактического исхода за день классифицируется только через состояния:
   `not_due` (scheduler явно ответил deferred с `due=false` / будущим
   `next_eligible_run_at`), `overdue_deferred` (deferred есть, но attest'а будущей
   eligibility нет), `unknown-missing-launch` (строк нет вовсе).
2. Только `not_due` не считается деградацией; `overdue_deferred` и
   `unknown-missing-launch` для required дают RED_DAY немедленно, для optional идут в
   бюджет §7.
3. Произвольный переиспользующий fallback «взять зелёный предыдущий день» запрещён
   полностью: параметр `COVERAGE_ALLOW_PREVIOUS_DAY` удалён из контракта builder'а.
   Зелёность дня D определяется исключительно строками с tick-атрибуцией дня D и
   последующим закрытием §16.
4. **B1 v4**: attest «не просрочен» действителен ТОЛЬКО при `next_eligible_run_at`,
   который парсится как дата и строго позже `started_at` самого deferred-прогона
   (контроль per-row, а не по произвольному последнему запуску дня). Прошедший,
   self-attestation «должен был запуститься, но не запустился» = `overdue_deferred`
   (review-сценарий A §18), никогда не an excuse.

### 17.2 Часовой tick ledger: expected-vs-observed (B3)

1. Workflow `source-refresh-clock.yml` печатает строку `source-refresh-provenance:`
   (`repository`, `run_id`, `run_number`, `attempt`, `scheduled_at`, `git_sha`,
   `http_status`, `body_sha256`) и загружает артефакт `proof-evidence/` с телом ответа;
   collector `scripts/collect-refresh-logs.mjs` строит по каждому запуску summary
   `<run_id>.json` со `schema_version: 2`.
2. Каждый сканированный запуск даёт файл: успех, 422 no-op, malformed/missing-payload —
   всё записывается (`schema_errors[]` + `tick_result`). Тихих пропусков каталогов нет.
3. Политика выхода workflow (fail-closed): HTTP 200 → exit 0 при отсутствии
   route-заявленных required-failures; HTTP 422 → явный no-op tick (`no-active-profiles`),
   job завершается warning'ом и НЕ считается success evidence'ом; всё остальное
   (207 с required failure, 207 сверх бюджета §7, 5xx, timeout, malformed, missing
   details) — non-zero exit + RED evidence ряда.
4. Ledger обязан содержать ровно 24 ожидаемых UTC-слота (`expected_slots_per_day=24`) и
   `observed_slot_count`; missing, duplicate или unresolved slot добавляет RED_DAY и
   блокирует публикацию окна. «Нет delta между ожидаемыми 24 tick'ами и наблюдаемыми
   launch'ами» — дефект дня, а не молчаливая норма; missing tick неотличим от инцидента
   по построению ledger'а.

### 17.3 Zero-success подлежит identity/delta контракту (B2)

1. `expected-zero`/`idempotent-replay` классифицируются `green_noop` только если все
   четыре условия выполняются одновременно:
   - policy contract источника декларирует `allow_zero_success=true` с allowlist причин
     (`config.json.zero_contracts`, canonical: `no-new-signals`,
     `derived-events-empty`; `source-unavailable` — деградация, а не zero-contract);
   - конкретная причина прогона входит в allowlist;
   - доступен upstream identity (`content_hash`/versionId/upstreamUpdatedAt);
   - delta verdict против published snapshot вчера ∈ {upstream-changed, unchanged,
     baseline-established}.
2. **B2 v4 распространяет gate на обычный `green`**: любой green (включая
   `ingested` и `ingested-with-duplicates`) обязан нести machine-readable
   `upstream_identity.fresh=true` с непустым `content_hash_sha256`, валидным
   `upstream_updated_at` и `delta_verdict.verdict` из того же allowlist. Green без
   датированной свежей identity или delta verdict понижается в `red`.
3. Произвольный `diagnostics.zeroReason` или пустая identity ⇒ `red` c
   `error_code=zero-reason-not-in-policy | zero-without-upstream-identity`. Регрессия на
   adversarial harness PR #240 («шести источникам произвольный expected-zero») покрывает это.
4. L2-предикат fresh-identity см. SQL в §3 (`declared_zero_7d` требует сравнения content_hash
   соседних наблюдений); сверка полей БД — задача миграции identity-колонок, до её
   применения declared-zero не апгрейдится до LINEAGE_OK автоматически.

### 17.4 Attribution дней по tick-slot и immutable close watermark (B4)

1. Каждому запуску присваивается scheduled tick slot: floor(started_at − grace) до часа,
   grace = 15 минут. День D содержит tick'и `[D 00:00Z, D+1 00:00Z)` — интервалы соседних
   дней НЕ пересекаются: run 2026-08-21T00:45Z принадлежит ТОЛЬКО дню 2026-08-21.
2. Late run обрабатывается как собственный tick своего часа (не ретроактивный исход чужого
   дня); закрывающие runs следующего дня участвуют только в close_condition дня D,
   но не в его day-level статусах.
3. После истечения последних tick'ов дня день закрывается watermark'ом: первый expected
   subsequent tick slot — `D+1 00:15Z`; допустимое окно close-witness — `[D 23:15Z,
   D+1 02:00Z]`. Каждый source обязан иметь non-deferred run с `tick_result=ok` внутри
   этого окна; иначе `<day>.pending.json` (PENDING_CLOSE), не учитываемый окном.
4. После `D+1 02:00Z` окно immutable: поздний run записывается как собственный поздний
   tick, но не может ретроактивно закрыть D; снапшот получает `backfill_rejected`, а гейт
   остаётся RED/NOT_READY (review-сценарий C §18).

### 17.5 Producer identity, хеш-цепочка и анти-tamper (B5)

1. Снапшот подписан fields-provenance вместо криптоподписи: producer (`repo_sha`
   полный 40-hex, `workflow_run_url`), `policy_sha256`/`schedules_sha256` из config
   manifest, `snapshot_hash = sha256(канонический JSON поля без snapshot_hash)`,
   `predecessor_snapshot_hash` предыдущего опубликованного дня (null у genesis).
2. Гейт окна recompute'ит каждый `snapshot_hash`, проверяет непрерывность цепочки в
   окне, соответствие repo_sha деплою и sha конфигурации manifest'у. Любой разрыв =
   NOT_READY fail-closed; fabricated unsigned окно (регрессия attacker-модели PR #240)
   отвергается механически.
   Проверка выполняется в направлении `oldest → newest`: для каждого следующего дня
   `predecessor_snapshot_hash` обязан равняться hash предыдущего опубликованного дня;
   reverse-order сверка запрещена. Builder также требует `run_id == filename stem`,
   repository summary == repository из `workflow_run_url` и один `git_sha` на весь
   собираемый день.
3. Ручные правки published snapshot эквивалентны tamper: recompute ломается и гейт
   падает; легальный путь исправления — superseded-file механика §10.1.
4. Артефакты workflow содержат тело upstream-ответа только в пределах минимальности:
   ошибки/счётчики/source ids/критичность; тела provider payload'ов, персональные
   контакты, креды в evidence запрещены (§12.5).

### 17.6 HTTP-политика тика: сверка критичности route ↔ orchestration

Целевой контракт route `/api/cron/source-refresh` (см. §11): `data.criticality ∈
{green, degraded, failing}`, `failedRequired`, `failedOptional`,
`deliveryImpactingFailure`. До внедрения этих полей workflow валидирует их наличие при
не-422 статусах и фейлит закрыто: отсутствие критичности в response — schema error,
а не «по умолчанию зелёно». Допустимые исходы тика сведены в таблицу:

| HTTP | Ответ | criticality/required | Exit workflow | Ledger-ряд |
| --- | --- | --- | --- | --- |
| 200 | details[] | green/degraded, failedRequired=0 | 0 | success |
| 207 | details[] | optional-only в бюджете §7 | 0 | degraded_ok |
| 207 | details[] | required failure ИЛИ вне бюджета | ≠0 | red |
| 422 | envelope | — | 4→warning | no_op (НЕ success) |
| прочее/timeout/malformed | что угодно | — | ≠0 | red/schema-error |
