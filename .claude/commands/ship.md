---
description: Run the pre-launch checklist via parallel fan-out to specialist personas, then synthesize a go/no-go decision
---

Invoke the agent-skills:shipping-and-launch skill.

`/ship` is a **fan-out orchestrator**. It runs three specialist personas in parallel against the current change, then merges their reports into a single go/no-go decision with a rollback plan. The personas operate independently — no shared state, no ordering — which is what makes parallel execution safe and useful here.

## Phase A — Parallel fan-out

Spawn three subagents concurrently using the Agent tool. **Issue all three Agent tool calls in a single assistant turn so they execute in parallel** — sequential calls defeat the purpose of this command.

In Claude Code, each call passes `subagent_type` matching the persona's `name` field:

1. **`code-reviewer`** — Run a five-axis review (correctness, readability, architecture, security, performance) on the staged changes or recent commits. Output the standard review template.
2. **`security-auditor`** — Run a vulnerability and threat-model pass. Check OWASP Top 10, secrets handling, auth/authz, dependency CVEs. Output the standard audit report.
3. **`test-engineer`** — Analyze test coverage for the change. Identify gaps in happy path, edge cases, error paths, and concurrency scenarios. Output the standard coverage analysis.

In other harnesses without an Agent tool, invoke each persona's system prompt sequentially and treat their outputs as if returned in parallel — the merge phase still works.

Constraints (from Claude Code's subagent model):
- Subagents cannot spawn other subagents — do not let one persona delegate to another.
- Each subagent gets its own context window and returns only its report to this main session.
- If you need teammates that talk to each other instead of just reporting back, use Claude Code Agent Teams and reference these personas as teammate types (see `references/orchestration-patterns.md`).

**Persona resolution.** If you've defined your own `code-reviewer`, `security-auditor`, or `test-engineer` in `.claude/agents/` or `~/.claude/agents/`, those take precedence over this plugin's versions — `/ship` picks up your customizations automatically. This is intentional: plugin subagents sit at the bottom of Claude Code's scope priority table, so user-level definitions win by design.

## Phase B — Merge in main context

Once all three reports are back, the main agent (not a sub-persona) synthesizes them:

1. **Code Quality** — Aggregate Critical/Important findings from `code-reviewer` and any failing tests, lint, or build output. Resolve duplicates between reviewers.
2. **Security** — Promote any Critical/High `security-auditor` findings to launch blockers. Cross-reference with `code-reviewer`'s security axis.
3. **Performance** — Pull from `code-reviewer`'s performance axis; cross-check Core Web Vitals if applicable.
4. **Accessibility** — Verify keyboard nav, screen reader support, contrast (not covered by the three personas — handle directly here, or invoke the accessibility checklist).
5. **Infrastructure** — Env vars, migrations, monitoring, feature flags. Verify directly.
6. **Documentation** — README, ADRs, changelog. Verify directly.

## Phase C — Decision and rollback

Produce a single output:

```markdown
## Ship Decision: GO | NO-GO

### Blockers (must fix before ship)
- [Source persona: Critical finding + file:line]

### Recommended fixes (should fix before ship)
- [Source persona: Important finding + file:line]

### Acknowledged risks (shipping anyway)
- [Risk + mitigation]

### Rollback plan
- Trigger conditions: [what signals would prompt rollback]
- Rollback procedure: [exact steps]
- Recovery time objective: [target]

### Specialist reports (full)
- [code-reviewer report]
- [security-auditor report]
- [test-engineer report]
```

## Recruiter Radar — additional infrastructure checks (Phase B)

When merging the three persona reports, also verify directly:

- **Migrations:** any new `packages/db/migrations/*.sql` is forward-only, idempotent where possible, and reviewed for production safety. Note rollback approach.
- **n8n boundary:** any change in `n8n/` does not move scoring, entity resolution, confidence gates, billing, suppression, digest state, feedback state, or prompt versioning into n8n. n8n exports must not contain real credentials.
- **Telegram:** webhook auth (Telegram secret token), idempotency, replay safety, callback acknowledgement.
- **Env vars:** new env vars added to `.env.example` and documented; production secrets are not committed.
- **FIUR contract:** scoring stays additive `Total = F + I + U + R`, components clamped to [0,1], total ∈ [0,4]. Test file `apps/web/src/__tests__/lib/scoring/fiur.test.ts` is green.
- **Confidence gates:** A and B auto-deliver, C requires review, D never delivered. Lead pipeline respects this.
- **Russian copy:** no «гарантированные клиенты», «100% результат», «автоматически закрываем продажи», «готовые сделки».
- **Verification:** `npm run web:check` green; `npm run web:build` green when routes/middleware/`next.config.*` changed; Jest run from `apps/web/` cwd.

## Persona resolution

This project ships local versions of `code-reviewer` and `security-auditor` in `.claude/agents/` with RR-specific invariants pre-loaded. Claude Code picks them up automatically (project scope > plugin scope). `test-engineer` falls back to the plugin version.
