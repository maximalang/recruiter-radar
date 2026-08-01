# Opportunity Intelligence v2 — Phase 8 TODO

- [x] Merge Phase 7 PR #125 into the integration branch.
- [x] Create Phase 8 from integration merge `ca9a052`.
- [x] Map export, workspace authorization, public reference and Outcome Ledger boundaries.
- [x] Record the Phase 8 contract and threat model.
- [x] Add public export projection and CSV/XLSX serializers with leak regression tests.
- [x] Add authenticated tenant-scoped opportunity export route.
- [x] Add integration and credential migrations with down migration.
- [ ] Add create, rotate and revoke credential lifecycle with one-time secret response.
- [ ] Add signed outbound webhook delivery with SSRF and audit controls.
- [ ] Add tenant-scoped inbound callback with signature, replay, rate and idempotency controls.
- [ ] Prove cross-workspace, revoked-credential and altered-replay rejection in PostgreSQL.
- [ ] Add n8n, amoCRM and Bitrix24 templates without secrets.
- [ ] Add fail-closed config, counters and rollout documentation.
- [ ] Run full checks and five-axis pre-merge review.
- [ ] Commit atomically, push, open one PR to `codex/opportunity-intelligence-v2`.
- [ ] Merge only after the final green merge-gate, then start Phase 9.
