# Opportunity Outcome Ledger: Phase 3 production canary

This is the authoritative Phase 3 procedure for a workspace-scoped production
canary. It does not authorize deployment, production access, runtime
configuration changes, or live traffic. Each of those actions requires an
explicit action-time approval for the exact target and commands.

## Stop conditions

Stop without creating data or enabling a global flag when any of the following
is true:

- the deployed commit has not been recorded exactly;
- the selected workspace is not internal or is not owned by the selected data
  owner;
- fewer than three genuine existing opportunities can safely cover the three
  independent lifecycle paths;
- there is no real internal user whose actor attribution can be verified;
- a second workspace session is unavailable for the cross-workspace denial;
- preflight or either canary gate returns non-zero, `ready=false`, or
  `activationReady=false`;
- a privacy, chronology, projection, meeting lifecycle, replay, or isolation
  violation is non-zero;
- external ingestion is enabled or any global Opportunity flag is `true`;
- the evidence recorder would need to store a contact, note, secret, session
  value, request body, internal identifier, or commercial amount.

Do not manufacture opportunities, move unrelated customer data, relax a gate,
or use an owner-wide allowlist to make the canary possible.

## Evidence contract

Create `docs/evidence/opportunity-canary-YYYY-MM-DD.md` from the current dated
artifact. Keep the marker and machine-readable fields. In evidence, represent
the owner and workspace only as independently calculated `sha256:` references;
never record the source IDs. Validate the file before review:

```powershell
npm.cmd run opportunity-outcomes:verify-canary-evidence -- --file docs/evidence/opportunity-canary-YYYY-MM-DD.md
```

`status: passed` is allowed only after every scenario and gate is checked, the
exact 40-character production SHA is present, and the command evidence includes
all required proof markers. `status: blocked` is the only valid result when live
execution is unavailable or a stop condition is met.

## 1. Read-only discovery

Run inside the production application container, where `DATABASE_URL` is
already injected. Do not print or copy the variable. Set the three numeric scope
variables only in the current shell; do not place their values in the evidence
file or command transcript.

```sh
export CANARY_OWNER_ID='<approved internal data owner>'
export CANARY_WORKSPACE_ID='<approved internal workspace>'
export CANARY_ACTOR_USER_ID='<approved internal user>'

npm run opportunity-outcomes:preflight -- --owner-id "$CANARY_OWNER_ID" --json
npm run opportunity-outcomes:canary -- \
  --owner-id "$CANARY_OWNER_ID" \
  --workspace-id "$CANARY_WORKSPACE_ID" \
  --pre-activation
```

Require `ok=true`, `phase=pre_activation`, `activationReady=true`, `ready=true`,
`ownerOpportunityCount>0`, all violation/drift counters `0`, all global flags
`false`, both allowlists empty, and external ingestion `false`. The pre-activation
command is read-only.

Using a read-only SQL session, confirm that the owner/workspace pair exists, the
actor is an active member with an Opportunity-capable role, and at least three
genuine opportunities in that exact workspace are suitable for the paths below.
Record counts only. Do not record IDs, names, notes, contacts, or amounts.

## 2. Process-local active probe

Keep every global Opportunity flag `false`, keep the owner allowlist empty, and
set exactly one workspace only for this process:

```sh
OPPORTUNITY_CANARY_WORKSPACE_IDS="$CANARY_WORKSPACE_ID" \
npm run opportunity-outcomes:canary -- \
  --owner-id "$CANARY_OWNER_ID" \
  --workspace-id "$CANARY_WORKSPACE_ID"
```

Require `phase=active`, `activationReady=true`, and `ready=true`. This command
must not change serving runtime configuration.

## 3. Serving activation

With separate approval, persist exactly one workspace in
`OPPORTUNITY_CANARY_WORKSPACE_IDS`, leave `OPPORTUNITY_CANARY_OWNER_IDS` empty,
leave all global Opportunity flags `false`, and restart only the application
runtime. Immediately repeat the active probe inside the new runtime. If it is
not ready, remove the workspace allowlist entry and restart before any manual
traffic.

## 4. Live user scenarios

Use the normal authenticated product UI and its `/outcomes` writer. Use three
genuine internal opportunities in the selected workspace so no backward or
synthetic transition is required.

1. Main funnel: `shown -> opened -> accepted -> contacted -> replied -> meeting -> meeting_completed -> proposal -> won`.
2. Workflow branch: `contacted -> snoozed -> resumed -> replied`.
3. Meeting branch: `meeting -> meeting_cancelled -> meeting -> meeting_completed`.
4. Correction branch on the main funnel: `won -> reverted -> proposal`.

For every user/admin event, verify in a read-only aggregate query that
`actor_user_id` equals the approved actor, `actor_workspace_id` equals the
approved workspace, and the recorded role snapshot is expected. Record only a
boolean/count. Verify system events do not claim a user actor.

From a valid session in another workspace, attempt both GET and POST for one
selected opportunity and require `404` with no state change. Do not copy cookies,
headers, request bodies, IDs, or response payloads into evidence.

## 5. Replay and conflict

In the authenticated browser network inspector, repeat one exact outcome request
with the same idempotency key and unchanged payload; require `200` and a replay
without a second ledger row. Then edit only the payload while retaining that key;
require `409` and no state change. Record only:

```text
idempotent_replay=true
changed_payload_status=409
```

Never record the key or payload.

## 6. Queues, funnel, and privacy

Verify the selected workspace only:

- Morning Brief contains active `new/review`, but not snoozed or completed rows;
- Pipeline contains active `contacted/replied/meeting/proposal` rows;
- Completed contains `won/lost/dismissed` rows;
- the operational summary and cohort funnel change by the expected aggregate
  deltas and retain the immutable first-shown cohort;
- history and API responses expose no internal IDs or raw contacts;
- the canary returns `rawContactRows=0`, and an approved privacy-safe log search
  finds no contact, note, request body, secret, or amount from the canary window.

Record counts and booleans only, never row payloads.

## 7. Rebuild parity

Apply and immediately re-run a dry-run for the exact workspace:

```sh
npm run opportunity-outcomes:rebuild -- \
  --apply \
  --owner-id "$CANARY_OWNER_ID" \
  --workspace-id "$CANARY_WORKSPACE_ID"

npm run opportunity-outcomes:rebuild -- \
  --dry-run \
  --owner-id "$CANARY_OWNER_ID" \
  --workspace-id "$CANARY_WORKSPACE_ID"
```

Require the final completion event to contain `rebuildChanged=0`.

## 8. External ingestion remains dark

From outside the authenticated browser, send a payload containing only the
non-production dummy reference below. No legacy secret is needed or allowed:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST "$BASE_URL/api/opportunities/outcomes/external" \
  -H 'content-type: application/json' \
  --data '{"opportunityRef":"00000000-0000-4000-8000-000000000000","externalSystem":"canary","eventType":"replied"}'
```

Require `404` and record only `external_status=404`.

## 9. Evidence completion and rollback

For a passing canary, check every scenario and gate, set `status: passed`, and
record these safe proof markers:

```text
preflight_ok=true
pre_activation_ready=true
active_ready=true
idempotent_replay=true
changed_payload_status=409
rebuildChanged=0
external_status=404
```

Run the evidence verifier. Then remove the workspace from
`OPPORTUNITY_CANARY_WORKSPACE_IDS`, restart the serving runtime, and confirm the
workspace-specific feature is dark while global behavior remains unchanged.
Preserve ledger rows and aggregate counters. Do not run a down migration as a
canary rollback. Global rollout remains a separate decision after stable review
of the complete evidence.
