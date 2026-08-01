# Legacy Opportunity Action API deprecation

## Status

`POST /api/opportunities/:id/action` is deprecated. Its successor is:

```text
POST /api/opportunities/:id/outcomes
```

The legacy endpoint is a compatibility adapter only. It authenticates the
caller, preserves the active workspace/actor context, converts the legacy
request to an outcome command, and delegates to the same append-only Outcome
Ledger writer as the successor endpoint. It does not own a state machine or
write `opportunity_actions`, `opportunities`, or `client_episode_state`
directly.

Responses carry:

```text
Deprecation: true
Link: </api/opportunities/:id/outcomes>; rel="successor-version"
```

Usage is counted through the structured
`opportunity.api.legacy_action_adapter_used` event. The event contains tenant,
workspace, opportunity, and action identifiers; it does not contain notes or
contact references.

## Compatibility contract

Legacy requests retain their response envelope:

```json
{
  "opportunity": {},
  "idempotent": false
}
```

The adapter uses the Outcome Ledger validation, tenant fencing, locking,
transition, append-only event, projection, and conflict contracts. Because the
legacy request has no `occurredAt` field, its idempotency fingerprint excludes
the server-generated timestamp. Retrying the same key and semantic request is a
replay; changing the action or action details with the same key is a conflict.

`dismissed` requires a controlled `reasonCode`. `contacted` requires a
controlled `channel`. Clients that cannot provide these fields must migrate
their interaction flow before enabling Outcome Ledger actions.

## Removal plan

1. Move every first-party UI caller to `/outcomes`.
2. Publish the deprecation headers and measure adapter usage.
3. Notify remaining API consumers with the canonical payload examples.
4. Keep the adapter for at least two stable releases after notification.
5. Start the removal window only after production telemetry has shown zero
   successful legacy calls for 30 consecutive days.
6. Remove the route, `applyOpportunityAction`, the legacy transition exports,
   and the `opportunity_actions` table in a dedicated migration after a final
   repository and production-log audit.

No calendar sunset date is declared until steps 1–5 have verifiable evidence.

## Rollback

Rollback the application change that routes callers through the adapter. Do not
delete Outcome Ledger events or reconstruct legacy action rows: the ledger and
its compatibility projection remain the source of truth.
