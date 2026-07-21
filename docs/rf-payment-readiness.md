# Russia-first payment readiness

**Статус:** provider selection blocked; Stripe-only adapter exists.

## Runtime truth

- `paymentsProvider.ts` поддерживает только `PAYMENTS_PROVIDER=stripe`.
- Self-service pilot считается готовым только когда одновременно настроены checkout, webhook и публичный site URL.
- Monthly и quarterly не проходят через payment provider. Это сохранённые sales requests без автоматического списания.
- При недоступном pilot provider заказ сохраняется, а пользователь получает понятный fallback вместо технической ошибки.

Operator state доступен через:

```text
GET /api/health/payment-readiness
x-api-key: <CRON_API_KEY>
```

Endpoint не возвращает secret names/values, customer contacts или provider payment IDs.

## Что требуется для RF provider

Перед статусом production-ready нужно отдельно подтвердить:

1. Выбранный merchant provider и договор для текущей формы бизнеса.
2. Sandbox credentials и создание платежа с idempotency key.
3. Подписанный webhook и replay-safe event ledger.
4. Live credentials и production callback URL.
5. Формирование чеков и обязательные реквизиты.
6. Refund, cancellation, partial refund и failed-payment semantics.
7. Entitlement expiry/revocation после отмены или возврата.
8. Accounting/legal review для самозанятого, ИП или ООО в фактической конфигурации продавца.

## Запрещённые shortcuts

- Нельзя выставлять `configured=true` без реальных credentials и webhook.
- Нельзя называть monthly/quarterly автоподпиской, пока нет recurring contract.
- Нельзя использовать fixture как подтверждение live payment.
- Нельзя хранить provider payload, ключи или customer contact в telemetry.

## Текущий внешний blocker

Выбор конкретного RF provider и merchant configuration не находится в репозитории. Код может подготовить adapter boundary и contract tests, но не может самостоятельно создать merchant account, пройти KYC, получить credentials или определить налоговый/чековый режим без фактических данных владельца.
