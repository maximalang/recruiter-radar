# Аналитика публичного лендинга

## Источники данных

Публичный лендинг использует два раздельных контура:

- Яндекс Метрика загружается только на `/`. Она получает pageview `/` и только
  валидные `utm_source`, `utm_medium`, `utm_campaign`. Параметры профиля,
  checkout, e-mail, заказ и другие query-параметры не передаются.
- `/api/landing-events` записывает обезличенные продуктовые события в
  PostgreSQL. Payload ограничен полями `name`, `context`, `timestamp`; raw IP не
  хранится. Checkout, onboarding и серверный `payment_succeeded` остаются только
  в first-party telemetry.

Production ID Метрики задаётся существующей переменной
`NEXT_PUBLIC_YANDEX_METRIKA_ID`. Второй счётчик не нужен.

## Основная воронка

```text
Landing view
→ Preview start
→ Preview generated
→ Pricing viewed
→ Checkout started
→ Payment succeeded
```

События:

| Шаг | Событие | Источник |
| --- | --- | --- |
| Landing view | `landing_viewed` | браузер, один раз при загрузке `/` |
| Preview start | `preview_started` | hero/header/preset/form; `context` хранит источник |
| Preview generated | `preview_generated` | только после реальной персонализированной выдачи |
| Preview results click | `preview_results_clicked` | переход к результату из hero |
| Pricing viewed | `pricing_viewed` | один раз при видимости не менее 35% секции |
| Checkout started | `checkout_started` | переход к self-serve пилоту |
| Payment started | `payment_started` | submit платёжной формы |
| Payment succeeded | `payment_succeeded` | серверный переход заказа в `paid`, идемпотентно |

`preview_started` не означает готовую выдачу. Конверсию preview нужно считать
по `preview_generated`, а не по клику или submit.

## Рекомендуемые отчёты

1. **Desktop / mobile.** Сегмент Метрики по типу устройства для pageview `/`;
   продуктовую конверсию сравнивать по тем же периодам.
2. **UTM source.** Метрика по `utm_source`, `utm_medium`, `utm_campaign`.
   Значения вне безопасного slug-формата отбрасываются.
3. **Hero CTA conversion.** `preview_started` с
   `context = hero_primary` / `landing_viewed`.
4. **Preview completion.** `preview_generated` / `preview_started`; отдельно
   контролировать источники `hero_primary`, `header`, `preset`, `form`.
5. **Preview → checkout.** `checkout_started` / `preview_generated`.
6. **Checkout → payment.** `payment_succeeded` / `checkout_started`; этот отчёт
   строится по first-party telemetry, потому что Метрика намеренно не
   загружается на checkout и страницах с данными заказа.

## Проверка релиза

`npm run test:landing:e2e` перехватывает `/api/landing-events` и проверяет точное
число запросов, разрешённые поля payload, отсутствие данных профиля,
одноразовый `pricing_viewed`, отсутствие раннего `payment_started`, а также то,
что Метрика не монтируется вне публичного лендинга.

Для production smoke endpoint поддерживает только неперсистентный payload
`landing_viewed` с `dryRun: true`. Полную оплату проверяет серверная
PostgreSQL-проверка `npm run test:payment-telemetry:db`.
