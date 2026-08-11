# Commercial Signal Engine + Evidence Radar — integration gate

Этот документ фиксирует финальную границу stacked-релиза Commercial Signal Engine phases 1–11 и Evidence Radar v1.

## Merge contract

- В `main` входит один final integration PR, а не последовательная цепочка промежуточных stacked PR.
- Перед merge integration head обязан быть совместим с актуальным `main`, а CI должен выполняться на PR merge-ref.
- Зелёный CI исходной верхней ветки не заменяет merge-ref validation после изменений `main`.
- Security audit, полный Jest/DB contract suite, Auth gates, production Next.js build, landing Playwright, responsive audit и Docker/Caddy smoke остаются обязательными.
- При синхронизации с текущим `main` сохраняются актуальные main-версии Next.js CSP/runtime config и CSP contract test; расширенные Commercial Signal checks остаются в общем `Tests` workflow, а lockfile пересобирается npm из объединённых workspace manifests и затем проходит production audit.

## Rollout boundary

Merge является additive/dark. Он не включает автоматически:

- `EVIDENCE_RADAR_V1_ENABLED`;
- Commercial Signal / Opportunity rollout flags;
- внешние source adapters, для которых не завершён source-specific legal/contract review;
- production backfill;
- reader switch;
- массовый outreach.

Активация выполняется отдельно после source review, dry-run качества и workspace canary.

Evidence Radar reader rollout не наследует широкий `OPPORTUNITY_COMMERCIAL_SIGNAL_UI_ENABLED` gate. Его минимальный runtime prerequisite — доступный для context базовый Opportunity Engine и валидный workspace; Outcome Ledger и workspace reader switch не используются Evidence Radar readers и не должны блокировать их canary.
