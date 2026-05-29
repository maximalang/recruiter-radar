---
description: Start spec-driven development — write a structured specification before writing code
---

Invoke the agent-skills:spec-driven-development skill.

Begin by understanding what the user wants to build. Ask clarifying questions about:
1. The objective and target users
2. Core features and acceptance criteria
3. Tech stack preferences and constraints
4. Known boundaries (what to always do, ask first about, and never do)

Then generate a structured spec covering all six core areas: objective, commands, project structure, code style, testing strategy, and boundaries.

## Recruiter Radar — spec discipline

- Specs that conflict with the product invariants in `CLAUDE.md` (FIUR additive form, confidence gates A/B/C/D, evidence-first leads, n8n boundary, Telegram callback contract) require explicit acknowledgement and a rationale section. Do not silently override invariants.
- Russian copy in spec UX flows must match the project's voice rules (no «гарантированные клиенты», «100% результат», «автоматически закрываем продажи», «готовые сделки»).
- Save the spec to `docs/specs/<feature>.md` if `docs/specs/` exists, otherwise to `SPEC.md` in the project root. Confirm with the user before proceeding.

