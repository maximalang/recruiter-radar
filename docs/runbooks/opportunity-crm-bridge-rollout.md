# Opportunity CRM Bridge rollout

## Default state

```dotenv
OPPORTUNITY_CRM_BRIDGE_ENABLED=false
```

This phase does not authorize deployment or activation. The old global
external-ingest flag has no effect and must remain false.

## Pre-activation gate

1. Confirm the deployed SHA and migration `20260801140000`.
2. Keep the bridge flag false while migrations run.
3. Run `npm.cmd run db:validate`.
4. Against an isolated PostgreSQL admin URL, run
   `npm.cmd run test:opportunity-crm-bridge:db`.
5. Run `npm.cmd run web:check` and `npm.cmd run web:build`.
6. Confirm the integration uses only an HTTPS public endpoint and provider
   credentials live outside Recruiter Radar templates and logs.
7. Create a test integration, store its one-time secret in the automation
   platform credential store, then discard it from operator notes/history.
8. Prove one explicit outbound event and one signed callback for a real
   internal workspace without personal contact data.
9. Prove a duplicate event is idempotent and an altered duplicate is rejected.
10. Obtain explicit production activation approval before setting the flag.

## Metrics and audit queries

Application events:

- `opportunity_crm.export_created`
- `opportunity_crm.integration_created`
- `opportunity_crm.credential_rotated`
- `opportunity_crm.credential_revoked`
- `opportunity_crm.delivery_completed`
- `opportunity_crm.callback_completed`
- `opportunity_crm.callback_rejected`

Database evidence comes from append-only
`opportunity_crm_deliveries` and `opportunity_crm_callback_receipts`. Monitor
success/failure or accepted/rejected counts by workspace and time window; do
not export secret hashes or callback bodies.

## Stop conditions

Disable the bridge flag immediately on any cross-workspace access, signature
verification drift, unexpected callback rate, outbound private-address
attempt, ledger/projection disagreement or credential disclosure. Rotation is
required after suspected disclosure; revocation is immediate and terminal.

## Rollback

1. Set `OPPORTUNITY_CRM_BRIDGE_ENABLED=false`.
2. Revoke affected active credentials.
3. Preserve delivery and callback audit rows for investigation.
4. Application rollback is safe while the additive tables remain.
5. The down migration intentionally refuses to run when any integration or
   audit state exists. Do not delete that state to force a rollback.
