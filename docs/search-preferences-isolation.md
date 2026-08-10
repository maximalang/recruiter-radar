# Search Preferences Isolation

`user_search_preferences` is tenant-owned Query Planner input. It is not shared source-ingestion configuration.

## Ownership contract

- Every row has an explicit `workspace_id` and `user_id`.
- Identity is `(workspace_id, user_id, source)` so one user can hold distinct preferences in different workspaces.
- Persisted `source` values use the namespace `planner:<source>`.
- Query Planner v2 must filter by both `preference.workspace_id = profile.workspace_id` and `preference.user_id = profile.owner_id` before removing the `planner:` namespace.
- Shared ingestion uses raw source ids such as `hh` and `superjob`; it must not consume `planner:*` rows as global configuration.

This keeps the shared signal pool global while preventing one tenant's search override from becoming another tenant's ingestion input.

## Migration and rollback

Migration `20260810120000_isolate_user_search_preferences.sql` backfills workspace ownership, namespaces existing rows, requires `workspace_id`, and changes the primary key to the workspace-scoped identity.

The down migration is intentionally fail-closed. If the same user has the same source preference in more than one workspace, rollback stops because the legacy `(user_id, source)` primary key cannot represent those rows without data loss.

## Rollout boundary

This change does not enable Query Planner v2, Commercial Signal Quality v2, canary execution, or any production feature flag. It only establishes the ownership boundary required before later rollout stages.
