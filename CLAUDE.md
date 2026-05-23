<!-- CODEGRAPH_START -->
## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | `codegraph_search` |
| "What calls function Y?" | `codegraph_callers` |
| "What does Y call?" | `codegraph_callees` |
| "What would break if I changed Z?" | `codegraph_impact` |
| "Show me Y's signature / source / docstring" | `codegraph_node` |
| "Give me focused context for a task/area" | `codegraph_context` |
| "See several related symbols' source at once" | `codegraph_explore` |
| "What files exist under path/" | `codegraph_files` |
| "Is the index healthy?" | `codegraph_status` |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture / trace questions, answer with 2-3 codegraph calls: `codegraph_context` first, then ONE `codegraph_explore` for the source of the symbols it surfaces. CodeGraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query immediately after editing a file in the same turn.

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"*
<!-- CODEGRAPH_END -->

## Recruiter Radar — Claude Code Project

### Product Identity

Recruiter Radar is a premium, Russia-first client-intelligence radar for recruitment agencies.

**It is NOT:**
- an ATS
- a CRM
- a generic job parser
- a mass outreach/spam tool
- a candidate sourcing product

**It IS:**
- a self-serve radar that helps recruitment agencies find companies worth contacting now
- an evidence-first product that explains why a company is relevant
- a quality-first product that prioritizes trust, dedupe, confidence, and feedback loops
- a Telegram-first delivery product with web onboarding and pilot activation

### Core Product Loop

```
Landing → live preview → pilot activation → client profile → Telegram connection →
daily digest → feedback buttons → suppression/reweighting → better future digests
```

### Tech Stack

- **Product core:** Next.js + Postgres
- **Orchestration only:** n8n (schedules, retries, webhook fan-out, operational alerts, calling product APIs)
- **Do NOT** put core business logic in n8n (scoring, entity resolution, confidence gates, billing, suppression, digest state, feedback state, prompt versioning)

### Quality Principles

Always optimize for trust and clarity over feature volume.

Every lead recommendation must answer:
1. Who is the company?
2. What changed?
3. Why does it matter now?
4. Why does it fit this agency profile?
5. What evidence supports it?
6. What is the safest lawful contact path?
7. What should the user do next?

**Do NOT create features** that produce more leads without improving evidence, confidence, dedupe, feedback, billing, delivery reliability, trust, security, activation, or conversion.

### FIUR Scoring Model

```
Total Score = 0.30 × Fit + 0.35 × Intent + 0.20 × Urgency + 0.15 × Reachability
```

- **Fit:** agency ICP match, role/function match, industry match, geography, company size, exclusions
- **Intent:** relevant vacancies, freshness, hiring burst, independent source confirmation, direct career page evidence
- **Urgency:** burst pattern, hard-to-fill roles, new region, corporate event, repeated/stale roles
- **Reachability:** corporate website, career page, generic HR contact path, safe non-personal contact route

Do NOT treat "company is hiring an internal recruiter" as a hot signal by itself.

### Confidence Gates

| Gate | Criteria | Delivery |
|------|----------|----------|
| **A** | 2+ independent evidence layers, clean entity match, direct company surface | Auto-deliver |
| **B** | 1 strong source + enrichment layer | Auto-deliver with confidence label |
| **C** | Platform-only aggregation or questionable entity match | Review required before delivery |
| **D** | Context without direct hiring proof | Do not create lead; store as supporting context |

### Telegram Digest Requirements

Telegram digest must be short, actionable, and stateful.

Each lead includes:
- company name, score, confidence
- why now, evidence summary
- best angle, safe next action

Inline buttons: Беру / Мимо / Позже / Уже написал / Ответили / Созвон / Клиент / Скрыть похожие

Callback handling must be: authenticated, idempotent, logged, replay-safe, connected to digest candidate state, reflected in future suppression/reweighting.

### Security Rules

**NEVER commit secrets.**

Forbidden in repository:
- real Telegram bot tokens, API keys, database URLs
- `.env`, `.env.local`, `.env.production`
- production n8n workflow exports containing secrets
- build caches, `.next`, `node_modules`, ZIP archives, private dumps

All secrets must be referenced through environment variables or credentials. Use `.env.example` for variable names only.

**NEVER read:**
- `.env` or `.env.*` files
- `node_modules/`
- `.next/` or `build/` or `dist/`

### Local Validation Commands

Before code changes: run preflight via standard agent tools

After code changes:
- Always run: `npm run web:check`
- Run `npm run web:build` only when: routes, middleware, `next.config.*`, or other build-sensitive code changed; OR `web:check` passed and the patch is commit-ready
- Do NOT run repeated check/build loops. If check fails, do one focused fix pass and stop.

If database migrations changed: inspect schema consistency and mention how to apply them.
If n8n workflow changed: confirm no secrets are present in exported JSON.
If Telegram webhook changed: describe authentication, idempotency, replay-safety, and callback acknowledgement.

### Code Standards

- Use TypeScript strictly
- Prefer small, explicit functions over large hidden logic
- Avoid broad rewrites unless necessary
- Do not add dependencies without a clear reason
- Keep Russian copy concise, premium, and specific

**Avoid:** "гарантированные клиенты", "100% результат", "автоматически закрываем продажи", "готовые сделки"

**Preferred:** "компании, которым стоит написать сегодня", "сигналы найма", "доказательства", "почему сейчас", "безопасный путь контакта", "ежедневный радар"

### Definition of Done

A task is done only when:
1. The patch is minimal and scoped to the task
2. Required checks pass, or failures are reported honestly
3. The final report includes: changed files, check results, risks, suggested commit message

### Memory System

This project uses auto-memory to store project context, user preferences, and workflow patterns. Memory files are stored in `memory/` directory.

### Available Skills

- `using-agent-skills` — meta-skill for skill discovery
- `context-engineering` — right context at the right time
- `incremental-implementation` — thin vertical slices, test each before expanding
- `security-and-hardening` — OWASP prevention, input validation, secrets
- `frontend-ui-engineering` — production-quality UI with accessibility