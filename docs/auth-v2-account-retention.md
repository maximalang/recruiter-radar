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
workspace with another active member. On success, the transaction:

1. creates one pending `account_deletion_requests` record;
2. marks solo owned workspaces `deletion_pending`;
3. removes active memberships;
4. revokes all sessions;
5. marks the account `deletion_pending`;
6. records `account_deletion_requested`.

Access is therefore removed immediately even when retention postpones purge.

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
- replaces retained account/challenge/invite email identity with a unique
  non-deliverable `deleted+<id>@deleted.invalid` address;
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
