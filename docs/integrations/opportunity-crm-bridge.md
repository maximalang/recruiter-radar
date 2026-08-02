# Opportunity CRM Bridge

The bridge exports or delivers one evidence-backed opportunity and accepts a
tenant-authenticated commercial outcome back into the canonical Outcome
Ledger. It is not a second CRM and does not enable automated outreach.

## Safety boundary

- `OPPORTUNITY_CRM_BRIDGE_ENABLED=false` is the default.
- Authenticated routes require an exact Auth v2 workspace.
- Integration creation and credential rotation/revocation require an active
  workspace owner or admin, rechecked inside the transaction.
- Credential material is returned once, stored only as a SHA-256 hash and is
  never included in application logs or template files.
- The legacy `/api/opportunities/outcomes/external` endpoint remains disabled.
- Payloads contain a public opportunity UUID and allowlisted company-level
  business data. They contain no owner/workspace IDs, internal hashes, notes,
  personal contacts or correspondence.
- Delivery is explicit per opportunity. There are no batches, touch sequences
  or automatic messages.

## Provisioning API

All responses containing a one-time secret use `Cache-Control: no-store`.

| Action | Method and path | Permission |
| --- | --- | --- |
| Create integration | `POST /api/opportunities/integrations` | `workspace:update` |
| Rotate active credential | `POST /api/opportunities/integrations/{integrationReference}/credentials/rotate` | `workspace:update` |
| Revoke active credential | `DELETE /api/opportunities/integrations/{integrationReference}/credentials/{credentialReference}` | `workspace:update` |
| Export | `GET /api/opportunities/export?format=csv|xlsx` | `exports:create` |
| Deliver one opportunity | `POST /api/opportunities/{opportunityId}/crm-deliveries` | `opportunities:write` |

Creating an integration requires `provider`, `displayName`, at least one
`allowedEventTypes` value and optional HTTPS `outboundWebhookUrl`,
`rateLimitPolicy` and `replayWindowSeconds`. The delivery endpoint requires a
printable `Idempotency-Key` and `integrationReference` in its JSON body.

## Signed webhook protocol

The one-time credential secret is the shared tenant secret. Both sides derive
the HMAC key as the 32 raw bytes of `SHA-256(credentialSecret)`.

The signed bytes are the exact UTF-8 string:

```text
{unixTimestamp}\n{eventId}\n{rawJsonBody}
```

The signature is lowercase hexadecimal HMAC-SHA256 with a `v1=` prefix.

| Header | Meaning |
| --- | --- |
| `X-RR-Credential-Id` | Public credential UUID |
| `X-RR-Webhook-Timestamp` | Unix timestamp in seconds |
| `X-RR-Webhook-Id` | Idempotent event ID |
| `X-RR-Signature` | `v1={hex-hmac}` |

Outbound delivery resolves every DNS answer, rejects the destination if any
answer is non-public, pins the connection to a checked address, disables
redirect following, times out after five seconds and caps the response at
64 KiB.

Delivery uses two short database transactions around the network request. The
first transaction validates access and acquires a 30-second delivery claim;
the HTTP request runs with no database transaction or row lock held; the
second transaction appends the immutable delivery result and releases the
claim. A concurrent request for the same deterministic event returns `409`.
The route also returns `429` with `Retry-After: 60` after 30 requests per
workspace per minute or 1,000 requests per application process per minute.

If the process stops after the receiver accepted a request but before the
result was persisted, a retry may resend the same deterministic event ID after
the stale claim expires. Receivers must deduplicate by `X-RR-Webhook-Id`.

## Outbound envelope

The event type is `opportunity.upserted`. The `opportunity` object contains only
the public reference, organization name/domain, business hypothesis and angle,
score/gate, current commercial/workflow state, next action fields and evidence
URLs. The event ID is deterministic for the integration, opportunity and
caller-provided idempotency key, so receivers can safely deduplicate retries.

## Tenant outcome callback

`POST /api/opportunities/integrations/{integrationReference}/outcomes`

The callback uses the same four signature headers. Its JSON body accepts only:

```json
{
  "opportunityReference": "00000000-0000-4000-8000-000000000000",
  "eventType": "won",
  "occurredAt": "2026-08-01T12:00:00.000Z",
  "valueMinor": 500000,
  "currency": "RUB"
}
```

Optional fields are `reasonCode`, `reasonNote`, `channel`, `contactPathType`,
`snoozeDays` and `snoozedUntil`. Personal contact values and arbitrary metadata
are rejected. The credential policy restricts event types, rate and replay
window. The public opportunity UUID must resolve in the credential workspace.
Accepted callbacks call `recordOpportunityOutcomeInTransaction`; the receipt
and Outcome Ledger append commit in one transaction.

## Provider templates

- `templates/n8n-opportunity-outcome-subworkflow.json` is disabled by default
  and contains no public Webhook trigger. Invoke it only from a provider flow
  that already authenticated the CRM event. Self-hosted n8n must expose the
  `crypto` built-in to the Code node and inject the three `RR_CRM_*` environment
  variables outside the workflow export.
- `templates/amocrm-opportunity.json` maps the public reference and business
  fields to an amoCRM lead. Create the named custom fields first and keep OAuth
  credentials in the automation platform credential store.
- `templates/bitrix24-opportunity.json` uses the universal `crm.item.add`
  method for a deal (`entityTypeId=2`) and symbolic custom-field placeholders.
  Keep OAuth or local-webhook secrets outside the template.

Provider references:

- [n8n Code node](https://docs.n8n.io/code/code-node/)
- [n8n module configuration](https://docs.n8n.io/hosting/configuration/configuration-examples/modules-in-code-node/)
- [amoCRM leads API](https://www.amocrm.ru/developers/content/crm_platform/leads-api)
- [amoCRM custom fields](https://www.amocrm.ru/developers/content/crm_platform/custom-fields)
- [Bitrix24 universal CRM item add](https://apidocs.bitrix24.ru/api-reference/crm/universal/crm-item-add.html)
- [Bitrix24 authorization](https://apidocs.bitrix24.ru/settings/how-to-call-rest-api/authorization.html)
