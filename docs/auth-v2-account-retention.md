# Auth v2 account retention and purge runbook

## Purpose and policy boundary

This runbook operates account deletion requests created by
`/settings/security`. It does not define a legal retention period. The approved
project policy owner must supply and document the actual values outside code.

Runtime configuration:

```text
AUTH_ACCOUNT_RETENTION_POLICY_KEY
AUTH_ACCOUNT_PURGE_AFTER_DAYS
```

- `AUTH_ACCOUNT_RETENTION_POLICY_KEY` is an audit label. It must match
  `[a-z][a-z0-9_-]{0,63}` and defaults to `manual_review`.
- When `AUTH_ACCOUNT_PURGE_AFTER_DAYS` is absent, the request has no automatic
  purge date and requires manual review.
- When set, the delay must be an integer from 1 through 3650 days. This range is
  an input-safety bound, not a recommended retention period.
- A policy or duration change applies to new requests. Existing requests keep
  their recorded policy key and `purge_after` timestamp and require an explicit,
  audited correction if policy governance calls for one.

## Request-time guarantees

An account deletion request requires recent authentication and the exact
confirmation phrase shown in the UI. It is refused while the account owns a
workspace with another active member. During the additive workspace migration,
it is also refused after role ownership transfer while an active workspace
still contains profiles, billing, lead, preference, delivery or Opportunity
rows keyed to the former owner's legacy `user_id`/`owner_id`. This fail-closed
boundary avoids partially rewriting immutable audit history; workspace-scoped
authorization and ownership migration must complete before that former account
can be deleted.

On success, the transaction:

1. creates one pending `account_deletion_requests` record;
2. disables owned client profiles, queued delivery jobs and every configured
   delivery route;
3. revokes push subscriptions, notification endpoints and provider accounts,
   and clears their contact destinations and provider credentials;
4. marks solo owned workspaces `deletion_pending`;
5. removes active memberships;
6. revokes all sessions;
7. marks the account `deletion_pending`;
8. records `account_deletion_requested`.

Access, premium entitlement and outbound delivery are therefore removed
immediately even when retention postpones identity purge.

Database guards serialize owner-scoped profile and delivery writes with the
account, membership and workspace rows. A write authorized before deletion
cannot wait for the deletion transaction and then restore profile, endpoint or
provider state.

## Safe operation

Always start with dry-run:

```text
npm.cmd run auth-v2:accounts:purge
```

The command reports only aggregate JSON:

```json
{"mode":"dry-run","eligible":0,"processed":0,"batchSize":100}
```

It selects only requests that are still `pending`, have a non-null
`purge_after` at or before database `NOW()`, and belong to an account still in
`deletion_pending`. Dry-run performs no mutation.

After confirming the approved policy, database target, backup posture and
aggregate count, apply one bounded batch:

```text
npm.cmd run auth-v2:accounts:purge -- --apply --batch-size=100
```

`--apply` is mandatory for mutation. Batch size is 1 through 500 and defaults
to 100. Rows are claimed inside a transaction with `FOR UPDATE ... SKIP
LOCKED`, so concurrent workers do not process the same request.

## What apply changes

For each due account, one transaction:

- keeps every session revoked and invalidates unconsumed auth challenges;
- replaces retained account/challenge email identity, accepted invites and
  outstanding invites targeting the previous account email with a unique
  non-deliverable `deleted+<id>@deleted.invalid` address;
- deletes revoked browser push endpoint keys; notification destinations and
  provider credentials were already cleared by the confirmed request;
- clears account name, Telegram identifiers, onboarding payload and recent-auth
  state;
- removes memberships and marks an empty solo `deletion_pending` workspace
  deleted;
- marks the user deleted and the request completed.

The user row is anonymized rather than physically removed because required
foreign-key ledgers remain attached to its stable identifier. The script does
not delete subscriptions, billing records or `auth_security_events`. Those
records remain subject to the separately approved project policy.

## Verification and rollback boundary

Before scheduling this command, run:

```text
npm.cmd run test:auth-v2:account-team:db
npm.cmd run db:validate
```

The database test creates and drops a dedicated disposable database, applies
all migrations, proves dry-run leaves state unchanged, proves apply touches
only due requests and verifies that subscription and security-audit counts are
preserved.

An applied anonymization is intentionally not self-service reversible. Restore
is an incident process requiring an approved database backup and policy-owner
decision. Do not edit a completed request back to `pending`.
