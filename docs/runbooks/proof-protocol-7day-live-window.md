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
SELECT
  source_id,
  COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '7 days') AS attempts_7d,
  COUNT(*) FILTER (WHERE outcome = 'success' AND completed_at > NOW() - INTERVAL '7 days') AS success_7d,
  MAX(completed_at) FILTER (WHERE outcome = 'success') AS last_success,
  SUM(duplicate_records) FILTER (WHERE completed_at > NOW() - INTERVAL '7 days') AS dupes_7d
FROM source_run_observations
WHERE source_id IN ('egrul-fns','transparent-business-fns','fns-open-data',
                    'cbr-registry','rosstat-open-data','rospatent-open-data')
GROUP BY source_id;
-- pass-критерий: success_7d >= 1 AND last_success >= NOW() - INTERVAL '7d+grace'
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
| `green` | данные верифицированно дошли до пайплайна | `ingested`, `ingested-with-duplicates`; `idempotent-replay` при подтверждённой свежести; `expected-zero` — только если контракт источника явно декларирует «может быть законно пустым» и детекция это подтвердила |
| `red` | верифицированный провал прогона | `failed`, `blocked`, `missing-summary`, `invalid-summary`, `unexpected-zero`, `normalization-zero`, `ingestion-zero`, `rate-limited` у required/unknown |
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
    # шестая шестёрка: egrul-fns required всегда зелёный для GREEN_DAY,
    # значит минимум 4 из 5 optional должны быть зелёными
MAX_CONSECUTIVE_DEGRADED_DAYS_PER_SOURCE = 2
    # один и тот же optional-источник может быть не-зелёным максимум 2 UTC-дня подряд;
    # третий день подряд => день автоматически RED_DAY
```

Превышение любой границы конвертирует день в `RED_DAY` и порождает запись в
`degradation_events[]` снапшота (§8). Границы применяются после fail-closed-правил §6:
они дают пространство манёвра только optional, никогда required.

## 8. Схема дневного immutable-снапшота покрытия

(d) Каждый UTC-день получает ровно один снапшот `source-refresh-coverage`, версия
схемы 1:

```json
{
  "schema_version": 1,
  "evidence_type": "source-refresh-coverage",
  "evidence_day_utc": "2026-08-26",
  "produced_at": "2026-08-27T00:10:00.000Z",
  "producer": {
    "repo_sha": "<git SHA запускающего деплоя>",
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
      "latency_ms": 3400,
      "error_code": null,
      "observation_row_ids": [101]
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
  "config_version_hash": "<sha256(repo_sha|policy_sha256|schedules_sha256)>",
  "day_status": "GREEN_DAY",
  "immutability": "append-only; изменения запрещены, исправления — новым файлом-заменой со ссылкой"
}
```

Правила схемы:

- `runs[]` обязан содержать все шесть источников; отсутствие элемента — дефект сборки
  снапшота, а не просто «нет данных»: такой снапшот не публикуется, день считается
  покрытым только полноценным файлом.
- Все счётчики ограниченные: id источников, статусы, исходы, числа, коды ошибок.
  Никогда — сырые provider payload'ы, персональные контакты, креды, тела upstream-ошибок.
- Связь с БД: `observation_row_ids` ссылается на `source_run_observations.id`, поэтому
  снапшот проверяем SQL-ом L2 в любой момент без чтения чего-либо ещё.
- `config_version_hash` фиксирует конфигурацию дня; два дня с разным hash внутри окна
  не блокируют окно, но об этом обязана быть запись в отчёте окна (детерминированность
  окон при смене версии конфигурации проверяется вручную @rr-support).

Снапшоты генерируются кодом приложения (не руками): коллектор после суточного цикла
читает `source_run_observations` за прошлый UTC-день, вычисляет статусы §5, применяет
границы §7, пишет файл и (при подключённой БД) строку-дубль в append-only таблицу.

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
5. Механическая формула проверки: взять последние N published coverage-файлов по
   `docs/evidence/source-refresh-coverage/…` (§10) и проверить
   `count == 7 AND every(day_status == 'GREEN_DAY')`. Никакого человеческого «скорее
   всего ок» между файлами.
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
