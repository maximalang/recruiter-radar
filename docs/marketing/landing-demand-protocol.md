# Протокол измерения спроса на лендинге (preregistration)

Задача: t_98d91920. Статус: размерности зафиксированы до открытия любого
наблюдаемого окна. Менять таксономию классов или определения воронки можно
только новым протоколом (v2) и новой версией контракта — не задним числом.

## 1. Вопросы

1. Какая доля визитов лендинга доходит до интерактивного просмотра
   (preview) и до checkout?
2. Чем различается спрос по источникам трафика и по типам устройств?
3. Какой визит привёл к заявке/оплате (linkage)?

## 2. Единица наблюдения

**Визит** = `visit_id` — серверный псевдонимный идентификатор (первые 32
hex-символа HMAC-SHA256 от суточного бакета и нормализованного IP с тем же
доменом секрета, что у rate-limit ключа, префикс `landing-visit`).

Свойства:

- никогда не покидает сервер (клиент идентификатор не получает и не
  передаёт; подмена невозможна);
- ротируется ежедневно, поэтому срок жизни linkage-ключа ограничен сутками
  без отдельной логики удаления;
- сырой IP не сохраняется — он используется только как вход key-производной
  функции на ingress, как и для существующего rate-limit ключа.

`visit_id` — отдельная колонка `product_telemetry_events.visit_id`, а не
`event_key`: `event_key` UNIQUE и `ON CONFLICT (event_key) DO NOTHING`
свернул бы всю воронку визита в одну строку.

## 3. Классы (зафиксированы до окна)

Все классы — из закрытых словарей (`apps/web/lib/telemetry-dimensions.ts`),
они же проверяются на ingress. Пустое значение ≠ `unknown`: отсутствие
класса и «класс определён как неизвестный» — разные состояния.

### referer_class (источник, по Referer GET-запроса лендинга)

| Класс | Значение |
|---|---|
| `relevant` | hh.ru, career.habr.com, habr.com, superjob.ru, zarplata.ru, vk.com, t.me, telegram.me, youtube.com, www.youtube.com, habr.career, getmatch.ru, huntly.ru, geekjob.ru |
| `not_relevant` | google.com, yandex.ru, ya.ru, duckduckgo.com, bing.com, mail.ru, go.mail.ru, rambler.ru, facebook.com, instagram.com, собственный домен (recruiter-radar.ru и хост приложения) |
| `unknown` | Referer отсутствует, не разобран или не входит в списки выше |

### utm_source_class (по `utm_source`, fallback `utm_campaign`)

| Класс | Значение |
|---|---|
| `relevant` | значение содержит один из маркеров: hh, habr, telegram, telega, tg, vk, vpiski, recruiter, recruiting, podbor, hr-, hr_, agency |
| `not_relevant` | значение содержит один из маркеров: google, yandex, ya-, ya_, seo, ads, cpc, context, direct, email, newsletter, unsubscribe |
| `unknown` | оба параметра отсутствуют или не содержат маркеров |

При совпадении маркеров разных классов побеждает `relevant` (порядок
проверки зафиксирован в коде).

### ua_class (по User-Agent GET-запроса)

Словарь `isUaClass` (`apps/web/lib/telemetry-dimensions.ts`): `browser`,
`bot`, `monitoring`, `internal`. `browser` — обычные браузеры, включая
мобильные и планшетные; класс не разделяет форм-факторы. `bot` —
боты/краулеры/превью-агенты и все клиентские библиотеки (bot/crawl/
spider/slurp, curl, wget, python-requests, python-urllib, java, okhttp,
go-http-client, headlesschrome, phantomjs, puppeteer, playwright,
lighthouse). `monitoring` — uptime/мониторинг (uptime, pingdom,
uptimerobot, betteruptime, statuspage, monitor, healthcheck, site24x7,
newrelic). `internal` — зарезервировано под внутренние инструментальные
агенты (сейчас не присваивается автоматически). Значение `unknown` в
словаре не существует: пустой или отсутствующий UA классифицируется как
`bot` (fail-closed), осмысленная строка всегда получает один из четырёх
классов.

### internal_marker (исключения из окна измерения, по параметру GET)

Словарь `isInternalMarker` (`apps/web/lib/telemetry-dimensions.ts`):
`none`, `preview`, `staff`, `healthcheck`. `none` (или отсутствие
параметра) = визит измеряем. Любое другое значение словаря = визит НЕ
попадает в окно (и в funnel, и в composition), но события сохраняются
как есть: `healthcheck` (`?rr_internal=healthcheck`) — uptime-мониторинг;
`preview` (`?rr_internal=preview`) — предпросмотр из
админских/инструментальных контекстов; `staff` (`?rr_internal=staff`) —
ручные проверки команды.

Ключ `rr_internal` выбран нейтральным и не пересекается с бизнес-параметрами
лендинга (`specialization`, `targetCity`, `includeKeywords`, `excludeKeywords`,
`planCode`). Значение вне словаря приравнивается к отсутствию маркера
(маркер остаётся `none`): визит не исключается и маркер в метрики не
пишется — решение по классу принимает ingress-нормализация, а не клиент.

## 4. Окно и воронка

Окно: календарная неделя UTC по умолчанию (`landing-demand-funnel.sql`,
переменные `window_start`/`window_end`).

Отчётные ряды (разрезы по referer_class × utm_source_class × ua_class):

- `landing_viewed` — уникальные `visit_id` с `landing_viewed` в окне;
- `preview_started` — визиты, у которых `preview_started` произошёл не
  раньше `landing_viewed` того же визита;
- `checkout_started` — аналогично от `checkout_started`;
- контрольные отношения 1:4:3 (protocol §4 из аудита):
  - `preview_rate` = preview_started / landing_viewed;
  - `checkout_rate` = checkout_started / preview_started.

### Исключения (часть словаря, не ad-hoc фильтры)

Из окна исключаются визиты с любым непустым `internal_marker` (т.е.
отличным от `none`) и с `ua_class` отличным от `browser` — мониторинг,
боты и внутренние агенты покидают окно целиком, осмысленный трафик без
классификации тоже (fail-closed). Дедупликация — по `visit_id`.

### Anti-spoofing

Классы вычисляются сервером из request-time заголовков на GET лендинга и
передаются клиенту только как значения словарей; клиент не может подставить
произвольную строку (ingress проверяет принадлежность словарю, посторонние
ключи и значения отбрасываются с 400). `internal_marker`-исключение тоже
проверяется сервером: непустой маркер из словаря исключает визит, неизвестное
значение — нет.

## 5. Linkage (привязка визита к исходу)

- Псевдонимный `visit_id` проставляется сервером на каждое событие
  лендинга (`landing_viewed`, `preview_started`, `checkout_started`,
  `continuation_cta_clicked` и др.) — обеспечивается дедупликация и
  упорядочивание стадий внутри визита.
- `attachment`-поле (data-analytics-attachment на continuation-CTA) —
  контекстная строка из безопасного алфавита `[0-9a-z_.:-]` длиной до 64
  символов, словарём не является; фиксирует контекст, из которого сделан
  клик — дольнейшее связывание с signup/order
  добавляется отдельным протоколом, когда соответствующие события начнут
  принимать binding key.
- Публичные обещания приватности (см. `/cookies`, §2) ограничивают хранение
  событий телеметрии 24 месяцами.

## 6. Эксплуатация

- TTL: `packages/db/scripts/cleanup-product-telemetry.mjs`
  (`--apply` / dry-run, advisory lock, батчи по 500, дефолт 730 дней,
  env: `PRODUCT_TELEMETRY_RETENTION_DAYS`, `..._BATCH_SIZE`,
  `..._MAX_BATCHES`). Запуск — по расписанию ops (ежедневно), как
  `auth:cleanup-challenges`.
- Отчёт: `packages/db/scripts/landing-demand-funnel.sql`
  (psql, детерминированный порядок строк).
- Заявленный срок в `/cookies` (24 месяца) опирается на TTL-джобу;
  состояние enforcement отражено в
  `docs/legal/retention-schedule.md`.
