---
description: Conduct a five-axis code review — correctness, readability, architecture, security, performance
---

Invoke the agent-skills:code-review-and-quality skill with the project-local `code-reviewer` subagent (`.claude/agents/code-reviewer.md`).

Review the current changes (staged or recent commits) across all five axes:

1. **Correctness** — Does it match the spec? Edge cases handled? Tests adequate?
2. **Readability** — Clear names? Straightforward logic? Well-organized?
3. **Architecture** — Follows existing patterns? Clean boundaries? Right abstraction level?
4. **Security** — Input validated? Secrets safe? Auth checked? (Use security-and-hardening skill)
5. **Performance** — No N+1 queries? No unbounded ops? (Use performance-optimization skill)

## Recruiter Radar — additional invariants to verify

- **FIUR scoring stays additive** in `apps/web/lib/scoring/fiur.ts`: `Total = Fit + Intent + Urgency + Reachability`, each ∈ [0,1], total ∈ [0,4].
- **Confidence gates A/B/C/D** govern delivery (auto / labeled / review / drop). Do not let a change bypass them.
- **Telegram callbacks** must be authenticated, idempotent, replay-safe, logged, and reflected in suppression/reweighting.
- **Session integrity:** signed `rr_sid` cookie only. No raw `rr_user_id`. `SESSION_SECRET` required in prod.
- **n8n boundary:** scoring, entity resolution, confidence gates, billing, suppression, digest state, feedback state, prompt versioning belong in product code, not n8n.
- **Russian copy:** reject «гарантированные клиенты», «100% результат», «автоматически закрываем продажи», «готовые сделки». Prefer «компании, которым стоит написать сегодня», «сигналы найма», «доказательства», «почему сейчас».
- **Verification:** `npm run web:check` is the default. `npm run web:build` only when routes/middleware/`next.config.*` changed. Jest must run from `apps/web/` cwd.

Categorize findings as Critical, Important, or Suggestion.
Output a structured review with specific file:line references and fix recommendations.

