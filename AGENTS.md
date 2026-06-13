# AGENTS.md — Codex / GitHub Workflow Rules

This file supplements `CLAUDE.md` with Codex-specific and GitHub workflow rules.
All product, scoring, security, validation, and code-style rules live in `CLAUDE.md` — this file does NOT duplicate them.

## 1) Codex / GitHub workflow

- `main` is the protected/stable branch. Do not open intermediate Codex PRs directly into `main`; do not push directly to `main`.
- Task branches must use `codex/<task>`.
- All intermediate Codex PRs must target the active integration branch (check `git branch -r` for current one).
- Do not create duplicate PRs. First check whether a matching open PR already exists for the same head/base.
- Do not claim that a PR, push, commit, or check succeeded unless the final report includes verifiable evidence: PR URL, commit SHA, and check/build logs or output.
- If the shell has no `origin`/push access, do not pretend a PR was created. Use the Codex/GitHub integration; if that is unavailable, provide the full patch and the exact reason.

### Git discipline for agents

- Start every git task with `git status --short --branch`, `git remote -v`, and a duplicate-PR check for the intended head/base pair.
- Keep commits atomic: one logical product/runtime/docs change per commit. Do not mix broad formatting with behavior changes.
- Before staging, review `git diff --stat` and the relevant `git diff`. Before committing, review `git diff --staged`.
- Stage only intentional files. Never add `.env`, `.env.*`, `.next`, `node_modules`, local caches, dumps, ZIPs, or private credentials.
- Run a staged secret scan before committing. If a real secret is found, stop, remove it, and report that rotation is required.
- Use descriptive commit messages in `<type>: <short description>` format, for example `feat: add source readiness checks`.
- Push task work to the task branch, not directly to `main`.
- Final reports for git tasks must include changed files, commit SHA, push target, PR URL or exact PR blocker, and check results.

## 2) Required preflight

Before code changes and before creating a PR, report:

1. current branch: `git branch --show-current`
2. working tree status: `git status --short`
3. remotes: `git remote -v`
4. whether a matching open PR already exists for the current head/base
5. which checks will be run

## 3) Pull request expectations

Every PR summary must include:

1. What changed.
2. Why it changed.
3. What product risk it reduces.
4. Commands run and results.
5. Any remaining risks or follow-up tasks.

Never hide failing checks. If something cannot be run, say why.

## 4) Privacy and legal design for Russia

Default to company-level data.

Do not introduce storage or processing of personal emails/phones unless explicitly required and reviewed.

Prefer lawful corporate contact paths:
- company form;
- public corporate email;
- generic HR/recruiting email;
- company switchboard;
- public official company channels.

Do not implement automatic mass outreach.

Outreach generation must remain draft/assist by default.

Keep data minimization, suppression, retention, and auditability in mind.

## 5) Billing and entitlement rules

Self-serve delivery must be entitlement-gated.

Before sending premium digests, check:
- active pilot;
- active subscription;
- allowed profile count;
- daily/weekly lead limit;
- delivery channel enabled.

Billing webhooks must be idempotent and stored in a webhook/event ledger.

Do not rely only on client-side state for plan access.

## 6) Data model expectations

Prefer explicit, auditable entities:

- organizations / companies;
- source references;
- signals;
- client profiles;
- digest runs;
- digest candidates;
- delivery attempts;
- feedback events;
- webhook events;
- billing events;
- subscriptions / entitlements;
- AI generation traces.

Lead recommendations must be evidence-backed.

Recommended lead card fields:

- company_display_name;
- legal_entity_name when available;
- inn / ogrn when available;
- domain;
- career_page_url;
- evidence_bundle[];
- fit_score;
- intent_score;
- urgency_score;
- reachability_score;
- confidence_gate;
- why_now;
- best_angle;
- lawful_contact_path;
- negative_signals[];
- delivery_status;
- feedback_status;
- cooldown_until;
- ai_summary;
- ai_prompt_version;
- ai_model;
- ai_trace_id.
