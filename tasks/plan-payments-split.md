# План: split монолита `apps/web/lib/payments.ts` (1780 строк)

## Цель
Разрезать billing-критичный монолит на связные слои **без изменения публичного API** и
**без изменения поведения**. `payments.ts` остаётся фасадом — ни один из 10 внешних
импортёров не правится. Валидация — `npm run web:check` (tsc), т.к. unit-тестов на модуль нет.

## Внешние импортёры (НЕ трогаем — фасад должен реэкспортировать ровно это)
| Файл | Импортирует |
|---|---|
| `app/page.tsx` | `getPaymentProviderSetupState` |
| `app/checkout/page.tsx` | `startCheckoutOrder` |
| `app/api/billing/webhook/route.ts` | `processPaymentWebhook` |
| `app/onboarding/pilot/[orderId]/actions.ts` | `completePilotOrderOnboarding`, `confirmPilotOrderProfile`, `sendPilotOrderTestDigest` |
| `app/onboarding/pilot/[orderId]/page.tsx` | `ensurePilotOrderOnboardingReady`, `getPilotActivationReadiness`, type `CheckoutOrder`, type `CheckoutOrderOnboardingStep` |
| `app/onboarding/pilot/[orderId]/pilot-onboarding-components.tsx` | type `CheckoutOrder`, type `CheckoutOrderOnboardingStep` |
| `app/checkout/order/[orderId]/success/page.tsx` | `ensurePilotOrderOnboardingReady`, `syncCheckoutOrderAfterSuccessReturn` |
| `app/checkout/order/[orderId]/cancel/page.tsx` | `buildCheckoutRetryHref`, `ensurePilotOrderOnboardingReady`, `markCheckoutOrderCanceled` |
| `lib/paymentsStripe.ts` | types `PaymentCheckoutSessionInput`, `PaymentCheckoutSessionResult`, `PaymentProviderAdapter` |
| `lib/telegramConnect.ts` | `savePilotOrderTelegramChat` |

## Существующий цикл (учесть)
`payments.ts` → импортирует значения из `paymentsStripe.ts`;
`paymentsStripe.ts` → импортирует **типы** из `payments.ts`.
Сейчас работает только потому, что это type-only import. После split типы переезжают в
`paymentsTypes.ts`, и цикл значение↔тип разрывается полностью (Stripe тянет типы из
`paymentsTypes`, не из фасада).

## Целевые модули

### 1. `lib/paymentsTypes.ts` (новый, ~180 строк)
Все публичные и внутренние типы + status-кортежи-константы (нужны для normalize):
- `CHECKOUT_ORDER_STATUSES`, `CheckoutOrderStatus`
- `CHECKOUT_ORDER_ONBOARDING_STATUSES`, `CheckoutOrderOnboardingStatus`
- `CHECKOUT_ORDER_ONBOARDING_STEPS`, `CheckoutOrderOnboardingStep`
- `CheckoutOrderPayload`, `CheckoutOrderRow`, `CheckoutOrder`
- `PilotOrderTestDigestResult`, `PilotActivationReadiness`
- `PaymentCheckoutSessionInput/Result`, `PaymentSyncResult`, `PaymentWebhookParseResult`
- `PaymentProviderAdapter`, `PaymentProviderSetupState`
- `StartCheckoutOrderInput/Result`, `UpdateCheckoutOrderInput`, `PaymentsDbClient`
- `PILOT_ENTITLEMENT_DAYS`
- **Без рантайм-зависимостей** кроме `pg` (для `PaymentsDbClient`) и `publicProduct` (для `PublicPlan`).
- `paymentsStripe.ts`: переключить import с `./payments` → `./paymentsTypes` (type-only, 3 типа).

### 2. `lib/paymentsNormalize.ts` (новый, ~230 строк)
Чистые функции без I/O и без БД:
`normalizeCheckoutOrderId`, `normalizeCheckoutOrderStatus`, `normalizeLinkedClientProfileId`,
`normalizeCheckoutOrderOnboardingStatus`, `normalizeCheckoutOrderOnboardingStep`,
`normalizeProductCode`, `normalizeSiteUrl`, `normalizeCurrency`, `normalizeRequiredText`,
`normalizeOptionalText`, `normalizeTelegramChatIdCandidate`, `normalizeDailyDigestLimit`,
`normalizeKeywordList`, `areKeywordListsEqual`, `normalizePayloadObject`, `readString`,
`readNumber`, `normalizeCheckoutOrderUserId`, `getErrorMessage`,
`mapDigestItemToTelegramDigestItem`, `mapCheckoutOrderRow`, `normalizeCheckoutOrderPayload`,
`mergeCheckoutOrderPayload`, `buildPaidOrderProfileSeed`, `doesClientProfileNeedSync`.
Зависит от: `paymentsTypes`, `clientProfiles` (VALID_*, parseKeywordText, ClientProfile),
`publicProduct`, `digest`/`hhDigest` (для mapDigestItem).

### 3. `lib/paymentsRepo.ts` (новый, ~420 строк)
Слой данных (всё, что бьёт в Postgres напрямую):
`getCheckoutOrderById` (export — фасад реэкспортит), `getCheckoutOrderByIdForOwner`,
`getCheckoutOrderByProviderPaymentId`, `createCheckoutOrder`, `updateCheckoutOrder`,
`ensurePilotEntitlementForPaidOrder`, `ensurePilotApplicationForOrder`,
`ensureClientProfileForPaidOrder`, `ensurePaidPilotOrderReady`, `getRequiredOrderClientProfile`.
Зависит от: `db-pool`, `paymentsTypes`, `paymentsNormalize`, `clientProfiles`, `publicProduct`.

### 4. `lib/paymentsProvider.ts` (новый, ~70 строк)
`getPaymentProviderSetupState`, `getConfiguredPaymentProvider`, `getPaymentProvider`.
Зависит от: `paymentsTypes`, `paymentsNormalize`, `paymentsStripe`.

### 5. `lib/payments.ts` (остаётся фасадом, ~520 строк)
Orchestration-функции:
`startCheckoutOrder`, `ensurePilotOrderOnboardingReady`, `getPilotActivationReadiness`,
`confirmPilotOrderProfile`, `savePilotOrderTelegramChat`, `sendPilotOrderTestDigest`,
`completePilotOrderOnboarding`, `syncCheckoutOrderAfterSuccessReturn`,
`markCheckoutOrderCanceled`, `processPaymentWebhook`, `buildCheckoutRetryHref`.
Плюс блок реэкспортов:
```ts
export type { CheckoutOrder, CheckoutOrderOnboardingStep, CheckoutOrderStatus,
  CheckoutOrderPayload, CheckoutOrderOnboardingStatus, PilotActivationReadiness,
  PilotOrderTestDigestResult, PaymentProviderAdapter, PaymentProviderSetupState,
  PaymentCheckoutSessionInput, PaymentCheckoutSessionResult, PaymentSyncResult,
  PaymentWebhookParseResult } from "./paymentsTypes";
export { getPaymentProviderSetupState } from "./paymentsProvider";
export { getCheckoutOrderById } from "./paymentsRepo";
```

## Зависимости (DAG — без циклов)
```
paymentsTypes  ← (база, без внутр. зависимостей)
   ↑
paymentsNormalize → paymentsTypes
   ↑
paymentsRepo → paymentsTypes, paymentsNormalize
   ↑
paymentsProvider → paymentsTypes, paymentsNormalize, paymentsStripe
   ↑
payments (фасад) → всё вышеперечисленное + digest/telegram/copy оркестрация
paymentsStripe → paymentsTypes (type-only)   [цикл разорван]
```

## Шаги выполнения
1. Создать `paymentsTypes.ts`, перенести типы + кортежи-константы + `PILOT_ENTITLEMENT_DAYS`.
2. Создать `paymentsNormalize.ts`, перенести чистые хелперы (+ `mapCheckoutOrderRow`,
   `normalize/mergeCheckoutOrderPayload`, seed/needsSync).
3. Создать `paymentsRepo.ts`, перенести БД-слой.
4. Создать `paymentsProvider.ts`, перенести provider-резолверы + setup state.
5. Переписать `payments.ts` как фасад: оставить оркестрацию, добавить импорты из новых
   модулей + блок реэкспортов.
6. Переключить `paymentsStripe.ts` import `./payments` → `./paymentsTypes`.
7. `npm run web:check`. Если падает — один сфокусированный фикс-проход.
8. `npm run web:build` (routes не менялись, но billing-критично — прогон сборки оправдан).

## Pre-merge gate (обязательно для billing)
- `/review` пять осей; resolve Critical.
- `codegraph_impact` на каждый перемещённый экспортируемый символ → orphaned callers = Critical.
- CodeGraph signature diff: ни одна сигнатура НЕ меняется (чистый move). Любое расхождение = баг.
- doubt-driven-development (billing-критичный путь): CLAIM → EXTRACT → DOUBT → RECONCILE → STOP.
- Особое внимание: `updateCheckoutOrder` транзакционность (передача `db` PoolClient в
  webhook BEGIN/COMMIT), `ensurePaidPilotOrderReady` идемпотентность, IDOR-границы
  `getCheckoutOrderByIdForOwner`.

## Риски
- **Нет unit-тестов** → регрессию ловит только tsc. Митигация: чистый move без правки тел,
  signature diff на каждый символ.
- **Циклы импортов** при неаккуратном разнесении. Митигация: строгий DAG выше, типы внизу.
- **Транзакционный `db`-проброс** должен сохраниться во всех repo-функциях (опциональный
  `db?: PaymentsDbClient` параметр везде, где он был).
