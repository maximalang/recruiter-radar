# SPEC — Multi-tenant Hardening + Stage-2 AI-assist

**Two sequential tasks:**
1. Multi-tenant hardening (owner-scoping in reads)
2. Stage-2 AI-assist: wire real LLM provider + prepare enrichment integration points

**Execution constraint:** Task 1 MUST be committed and pushed before Task 2 begins. If Task 1 runs long, stop after it.

---

## TASK 1 — Multi-tenant Hardening (Owner-scoping in Reads)

### Objective

Prevent IDOR: user A cannot read user B's profile, leads, or digest data through any user-facing page. Actions are already owner-scoped; reads are not yet.

**Target users:** recruitment agencies using Recruiter Radar in multi-tenant mode (beyond pilot).

### Acceptance Criteria

**Must-have:**
- [ ] All user-facing read paths that expose profile/lead/digest data require `ownerId` and filter `WHERE owner_id = $1 OR owner_id IS NULL` (pilot mode).
- [ ] Pages (`/leads`, `/leads/[id]`, `/settings/profile`, `/dashboard`, `/review`) resolve `ownerId` from session and pass it to reads.
- [ ] Existing owner-scoped action pattern (`verifyProfileOwnership`) is reused for read-path auth.
- [ ] Tests: user A cannot read user B's profile fit/explanation data via any read path.
- [ ] Typecheck passes, full test suite green.
- [ ] Committed and pushed before Task 2 starts.

**Out of scope:**
- Changing scoring, gating, or delivery logic.
- Inventing new auth/JWT layers (reuse existing session.ts).
- Admin/internal-only paths (if already behind separate middleware, document them clearly).

### Core Features

#### 1. Session resolver on pages

**Pattern:**
```typescript
// In server component/page (e.g., app/leads/page.tsx)
import { getOwnerIdFromSession } from '@/lib/session';

export default async function LeadsPage() {
  const ownerId = await getOwnerIdFromSession();
  if (!ownerId) {
    // Redirect to login or show unauthenticated state
  }
  const leads = await getLeadsForAllProfiles({ ownerId, profileIds: [...] });
  // ...
}
```

**Do NOT:**
- Create new middleware unless absolutely necessary.
- Make reads broadly accessible to any authenticated user.

#### 2. Read-function signatures

**Current unsafe reads (must add ownerId):**
- `getLeadDetail({ candidateId })` → `getLeadDetail({ candidateId, ownerId })`
- `getLeadsForAllProfiles({ profileIds, ... })` → `getLeadsForAllProfiles({ profileIds, ownerId, ... })`
- `listClientProfiles()` → `listClientProfiles(ownerId)`
- `getClientProfileById(id)` → `getClientProfileById(id, ownerId)` (or reuse existing `getClientProfileByOwnerId` where applicable)
- `getPendingReviewCount()` → `getPendingReviewCount(ownerId)`

**Owner-scoping SQL pattern:**
```sql
WHERE client_profiles.owner_id = $1
  AND dc.client_profile_id = ANY($2)
```

**Pilot mode (`owner_id IS NULL`):**
- Pilot records are accessible ONLY through explicitly pilot-safe flows.
- Do NOT add global `OR owner_id IS NULL` to every read.
- Default posture: deny unless explicitly pilot-safe.

#### 3. Backward compatibility

**Non-page callers (cron, API routes, n8n):**
- If unsafe read paths remain for internal use, mark them clearly as `__internal` or `__unsafe` and document why.
- Preferred: replace unsafe reads cleanly. Security goal > backward compat.

**Migration path:**
- Extend signatures (add `ownerId` param).
- Pages/user-facing entry points MUST pass `ownerId`.
- Internal callers use dedicated internal variants if needed.

### Testing Strategy

**Unit tests:**
- `lib/clientProfiles.test.ts` — user A cannot read user B's profile via `getClientProfileById(id, ownerIdA)` when profile belongs to ownerIdB.
- `lib/leads-data.test.ts` — `getLeadDetail({ candidateId, ownerId })` returns null when lead's profile belongs to different owner.
- `lib/leads-data.test.ts` — `getLeadsForAllProfiles({ profileIds, ownerId })` filters out profiles not owned by ownerId.

**Integration tests (optional, if time allows):**
- E2E test: user A logs in, navigates to `/leads/[id]` for a lead belonging to user B's profile → 404 or access denied.

**Validation commands:**
- `npm run web:check` — typecheck
- `npm test` — full suite must stay green

### Project Structure

**Modified files:**
```
apps/web/
  lib/
    session.ts              [no changes — reuse existing getOwnerIdFromSession]
    clientProfiles.ts       [add ownerId to reads, WHERE owner_id = $1]
    leads-data.ts           [add ownerId to getLeadDetail, getLeadsForAllProfiles]
  app/
    leads/
      page.tsx              [resolve ownerId, pass to reads]
      [id]/page.tsx         [resolve ownerId, pass to getLeadDetail]
    settings/
      profile/page.tsx      [resolve ownerId, pass to profile read]
    dashboard/
      page.tsx              [resolve ownerId, pass to metrics reads]
    review/
      page.tsx              [resolve ownerId if exists]
  src/__tests__/
    lib/
      clientProfiles.test.ts [new: owner isolation tests]
      leads-data.test.ts     [new: owner isolation tests]
```

**New files:** None (unless dedicated internal-read variants are needed).

### Code Style

- TypeScript strict mode.
- Small, explicit functions — one responsibility per function.
- Use parameterized queries (`$1`, `$2`) — never string interpolation.
- Russian comments/copy where user-facing.
- Match existing session.ts / actions.ts auth patterns.

### Boundaries

**Always:**
- Reuse `getOwnerIdFromSession()` from session.ts — no new auth.
- Add `WHERE owner_id = $1` to every user-facing read query.
- Tests must prove isolation (user A ≠ user B).

**Ask first:**
- Adding `owner_id IS NULL` pilot-mode access to a new read path (confirm it's genuinely pilot-safe).
- Creating internal-only unsafe read variants (confirm necessity).

**Never:**
- Expose one user's profile/fit/explanation to another user via any read path.
- Change scoring/gating/delivery logic in this task.
- Invent JWT or new middleware layers.

---

## TASK 2 — Stage-2 AI-assist + Enrichment Tool Integration

### Objective

Wire a real LLM provider (vendor-agnostic, custom API with multiple models). Prepare clean integration points for enrichment tools (Crawl4AI, ScrapeGraphAI, n8n workflows). Focus AI on **improving lead quality/quantity** (better extraction, classification, signal interpretation), NOT on copywriting polish.

**Target users:** Recruiter Radar operators + n8n workflow authors who enrich weak lead signals.

### Acceptance Criteria

**Must-have:**
- [ ] Vendor-agnostic LLM provider adapter wired to existing custom API (OPENAI_BASE_URL + OPENAI_API_KEY from .env).
- [ ] At least one real enrichment path: missing industry classification OR weak career-page structured extraction.
- [ ] AI-enriched fields stored separately from source evidence (dedicated table or explicit provenance fields).
- [ ] `assertNoOverride` guard from Stage-1 boundary stays active — AI cannot mutate score/gate/evidence.
- [ ] Cost tracking: DB table `ai_usage_log` (timestamp, profile/org context, provider/model, tokens, estimated cost).
- [ ] Rate limiting: basic global + per-capability guardrails (not over-designed per-profile quotas yet).
- [ ] Crawl4AI and/or ScrapeGraphAI interface defined (TypeScript contract), deployment optional in this session.
- [ ] n8n enrichment endpoint: `POST /api/ai/enrich` with shared-secret auth.
- [ ] Tests: provider adapter mocked, assertNoOverride holds, cost tracking tested, full suite green.

**Nice-to-have (only if Task 2 going smoothly):**
- [ ] Fit explanation enhancement: one optional AI sentence on top of Stage-1 deterministic explanation.

**Deferred (Stage-3+):**
- Outreach draft (AI copywriting).
- Per-profile AI quota enforcement.
- Full Crawl4AI/ScrapeGraphAI deployment (define interface now, deploy later).

**Out of scope:**
- AI-only features with no deterministic fallback.
- Overwriting source evidence fields with AI-generated data.
- Letting AI compute score/gate/evidence.

### Core Features

#### 1. LLM Provider Adapter (Vendor-Agnostic)

**Pattern:**
```typescript
// apps/web/lib/ai/providers/custom-api.ts
import { AiCapability } from '../boundary';

export interface LlmProviderConfig {
  baseUrl: string;      // OPENAI_BASE_URL from env
  apiKey: string;       // OPENAI_API_KEY from env
  model: string;        // configurable model name
  maxTokens?: number;
  temperature?: number;
}

export interface LlmRequest {
  capability: AiCapability;
  prompt: string;
  context?: Record<string, unknown>;
}

export interface LlmResponse {
  result: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: string;
}

export async function callLlm(
  config: LlmProviderConfig,
  request: LlmRequest
): Promise<LlmResponse> {
  // POST to baseUrl + '/chat/completions' (OpenAI-compatible format)
  // Return structured response with token counts
}
```

**Do NOT:**
- Hardcode Anthropic SDK or OpenAI SDK directly in business logic.
- Make the provider un-swappable (keep config-driven).

#### 2. Enrichment Storage (Separate from Source Evidence)

**Schema (new table):**
```sql
CREATE TABLE org_enrichments (
  id SERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id),
  field_name TEXT NOT NULL,        -- 'industry', 'size', 'structured_jobs', etc.
  ai_value JSONB NOT NULL,         -- enriched data
  provider TEXT NOT NULL,          -- 'custom-api', 'scrapegraph', 'crawl4ai'
  model TEXT,                      -- model name if LLM-generated
  capability TEXT,                 -- AI capability used
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, field_name)       -- one enrichment per field per org (upsert)
);

CREATE INDEX idx_org_enrichments_org_id ON org_enrichments(org_id);
```

**Alternative (if minimal):**
Add columns to `orgs`:
```sql
ALTER TABLE orgs
  ADD COLUMN ai_inferred_industry TEXT,
  ADD COLUMN ai_inferred_size TEXT,
  ADD COLUMN ai_enriched_at TIMESTAMPTZ,
  ADD COLUMN ai_provider TEXT;
```

**Preferred:** Dedicated `org_enrichments` table for clear separation + provenance.

#### 3. AI Capabilities (Priority Order)

**MUST HAVE in Task 2:**

##### (1) Enrich missing structured data
- **Use case:** org has `name` and `website_url` but `industry IS NULL` → classify industry via LLM.
- **Implementation:**
  ```typescript
  // apps/web/lib/ai/enrichment/classify-industry.ts
  import { callLlm } from '../providers/custom-api';
  import { isAllowedCapability } from '../boundary';

  export async function classifyIndustry(orgName: string, websiteUrl: string): Promise<string | null> {
    if (!isAllowedCapability('classify-intent')) return null; // or new capability 'classify-industry'
    
    const prompt = `Company: ${orgName}\nWebsite: ${websiteUrl}\nIndustry (one word):`;
    const response = await callLlm(getProviderConfig(), {
      capability: 'classify-intent', // or register new 'classify-industry'
      prompt,
    });
    
    await logAiUsage({ capability: 'classify-industry', ...response });
    return response.result.trim();
  }
  ```
- **Storage:** `INSERT INTO org_enrichments (org_id, field_name, ai_value, provider, model) VALUES ($1, 'industry', $2, 'custom-api', $3)`.

##### (2) Improve signal interpretation
- **Use case:** career page has noisy HTML, weak structured data → extract structured job postings via Crawl4AI (clean markdown) + LLM.
- **Implementation:**
  - Define Crawl4AI interface:
    ```typescript
    // apps/web/lib/ai/scrapers/crawl4ai.ts
    export interface Crawl4AIRequest {
      url: string;
      options?: { screenshot?: boolean; pdfMode?: boolean };
    }

    export interface Crawl4AIResponse {
      markdown: string;
      screenshot?: string;
      success: boolean;
    }

    export async function crawl4ai(req: Crawl4AIRequest): Promise<Crawl4AIResponse> {
      // POST to CRAWL4AI_API_URL (from env) — external service
      // Return clean markdown
      // If service not deployed yet, return { markdown: '', success: false }
    }
    ```
  - Use markdown as LLM context:
    ```typescript
    const crawlResult = await crawl4ai({ url: careerPageUrl });
    if (!crawlResult.success) return null;
    
    const prompt = `Extract structured job postings from this career page:\n\n${crawlResult.markdown}\n\nReturn JSON array.`;
    const response = await callLlm(config, { capability: 'extract-weak-signal', prompt });
    const jobs = JSON.parse(response.result);
    
    await logAiUsage({ capability: 'extract-weak-signal', ...response, orgId });
    // Store in org_enrichments
    ```

**NICE TO HAVE in Task 2 (only if time allows):**

##### (3) Fit explanation enhancement
- Stage-1 deterministic fit explanation stays as ground truth.
- AI adds ONE optional synthesis sentence on top.
- Example:
  ```typescript
  const deterministicFit = buildFitExplanation(lead, profile); // Stage-1
  const aiSynthesis = await callLlm(config, {
    capability: 'explain-fit',
    prompt: `Synthesize in one sentence why this lead fits:\n${JSON.stringify(deterministicFit)}`,
  });
  
  return {
    ...deterministicFit,
    aiSynthesis: aiSynthesis.result, // optional, clearly marked as AI
  };
  ```

**DEFERRED (Stage-3+):**
- (4) Outreach draft — AI copywriting.

#### 4. ScrapeGraphAI Integration (Interface Only)

```typescript
// apps/web/lib/ai/scrapers/scrapegraph.ts
export interface ScrapeGraphAIRequest {
  url: string;
  schema: Record<string, unknown>; // JSON schema for structured extraction
}

export interface ScrapeGraphAIResponse {
  data: Record<string, unknown>;  // extracted structured data matching schema
  success: boolean;
}

export async function scrapegraph(req: ScrapeGraphAIRequest): Promise<ScrapeGraphAIResponse> {
  // POST to SCRAPEGRAPH_API_URL (from env) — external Python service
  // If service not deployed yet, return { data: {}, success: false }
}
```

**Deployment:** Optional in Task 2. Define interface now, deploy Python service later.

**Priority:** Crawl4AI first (cleaner text acquisition), ScrapeGraphAI second (structured extraction).

#### 5. n8n Enrichment Workflow Endpoint

**API Route:**
```typescript
// apps/web/app/api/ai/enrich/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function POST(req: NextRequest) {
  // Auth: shared secret in header
  const authHeader = (await headers()).get('x-ai-enrich-secret');
  if (authHeader !== process.env.AI_ENRICH_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { orgId, fieldName, aiValue, provider, model, capability } = body;

  // Validate input
  if (!orgId || !fieldName || !aiValue) {
    return NextResponse.json({ error: 'missing required fields' }, { status: 400 });
  }

  // Write to org_enrichments
  const pool = getPool();
  await pool.query(`
    INSERT INTO org_enrichments (org_id, field_name, ai_value, provider, model, capability)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (org_id, field_name) DO UPDATE
      SET ai_value = $3, provider = $4, model = $5, capability = $6, created_at = NOW()
  `, [orgId, fieldName, JSON.stringify(aiValue), provider, model, capability]);

  return NextResponse.json({ ok: true });
}
```

**Auth:** `x-ai-enrich-secret` header = `process.env.AI_ENRICH_SECRET` (shared secret).

**Response:** Synchronous (enrichment written immediately). Async callback can be added later if needed.

**n8n workflow example:**
1. n8n receives org_id + weak signal (via webhook/schedule).
2. n8n HTTP node calls LLM (via n8n's built-in LLM nodes or custom HTTP).
3. n8n HTTP node POSTs enriched data to `/api/ai/enrich`.

#### 6. Cost Tracking + Rate Limiting

**Cost tracking table:**
```sql
CREATE TABLE ai_usage_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  org_id BIGINT REFERENCES orgs(id),           -- nullable if not org-specific
  client_profile_id BIGINT REFERENCES client_profiles(id), -- nullable
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  capability TEXT NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  estimated_cost_usd DECIMAL(10, 6),           -- calculated from token counts + pricing
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT
);

CREATE INDEX idx_ai_usage_log_timestamp ON ai_usage_log(timestamp);
CREATE INDEX idx_ai_usage_log_org_id ON ai_usage_log(org_id);
```

**Cost tracking function:**
```typescript
// apps/web/lib/ai/usage.ts
export async function logAiUsage(params: {
  orgId?: string;
  clientProfileId?: string;
  provider: string;
  model: string;
  capability: string;
  promptTokens: number;
  completionTokens: number;
  success: boolean;
  errorMessage?: string;
}): Promise<void> {
  const estimatedCost = calculateCost(params.model, params.promptTokens, params.completionTokens);
  
  const pool = getPool();
  await pool.query(`
    INSERT INTO ai_usage_log (org_id, client_profile_id, provider, model, capability, prompt_tokens, completion_tokens, estimated_cost_usd, success, error_message)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [params.orgId, params.clientProfileId, params.provider, params.model, params.capability, params.promptTokens, params.completionTokens, estimatedCost, params.success, params.errorMessage]);
}

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  // Pricing table (update as models change)
  const pricing: Record<string, { prompt: number; completion: number }> = {
    'gpt-4o': { prompt: 0.000005, completion: 0.000015 },
    'gpt-4o-mini': { prompt: 0.00000015, completion: 0.0000006 },
    // Add more models
  };
  
  const rate = pricing[model] ?? { prompt: 0, completion: 0 };
  return promptTokens * rate.prompt + completionTokens * rate.completion;
}
```

**Rate limiting:**
- Global: max N AI requests per minute (via in-memory counter or Redis).
- Per-capability: max M 'classify-industry' requests per hour.
- Do NOT over-design per-profile quotas yet (defer to Stage-3).

**Implementation:**
```typescript
// apps/web/lib/ai/rate-limit.ts
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  
  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (record.count >= maxRequests) {
    return false; // rate limit exceeded
  }
  
  record.count++;
  return true;
}
```

**Usage:**
```typescript
if (!checkRateLimit('global', 100, 60000)) {
  throw new Error('AI rate limit exceeded');
}
```

### Testing Strategy

**Unit tests:**
- `lib/ai/providers/custom-api.test.ts` — callLlm returns mocked response with token counts.
- `lib/ai/boundary.test.ts` — assertNoOverride still throws on protected field mutation after Stage-2 integration.
- `lib/ai/usage.test.ts` — logAiUsage writes to ai_usage_log, calculateCost returns correct estimate.
- `lib/ai/enrichment/classify-industry.test.ts` — classifyIndustry calls LLM and stores enrichment (mocked provider).
- `lib/ai/scrapers/crawl4ai.test.ts` — crawl4ai interface returns expected shape (mocked HTTP).

**Integration tests (optional):**
- E2E: POST to `/api/ai/enrich` with valid secret → writes to org_enrichments.
- E2E: POST to `/api/ai/enrich` with invalid secret → 401.

**Validation commands:**
- `npm run web:check` — typecheck
- `npm test` — full suite green

### Project Structure

**New files:**
```
apps/web/
  lib/
    ai/
      providers/
        custom-api.ts             [LLM provider adapter]
      scrapers/
        crawl4ai.ts               [Crawl4AI interface]
        scrapegraph.ts            [ScrapeGraphAI interface]
      enrichment/
        classify-industry.ts      [missing industry classification]
        extract-jobs.ts           [career page → structured jobs]
        n8n-contract.ts           [types for n8n enrichment endpoint]
      usage.ts                    [cost tracking + rate limiting]
      rate-limit.ts               [in-memory rate limiter]
  app/
    api/
      ai/
        enrich/
          route.ts                [POST endpoint for n8n enrichment]
  src/__tests__/
    lib/
      ai/
        providers/
          custom-api.test.ts      [provider adapter tests]
        enrichment/
          classify-industry.test.ts [enrichment tests]
        usage.test.ts             [cost tracking tests]
        scrapers/
          crawl4ai.test.ts        [scraper interface tests]
```

**Modified files:**
```
apps/web/
  lib/
    ai/
      boundary.ts               [no changes — stays dependency-free]
      assist-types.ts           [may add new capability 'classify-industry']
  .env.example                  [add AI_ENRICH_SECRET, CRAWL4AI_API_URL, SCRAPEGRAPH_API_URL]
```

**New DB tables:**
```sql
-- apps/web/migrations/XXX_ai_enrichment.sql
CREATE TABLE org_enrichments (...);
CREATE TABLE ai_usage_log (...);
```

### Code Style

- TypeScript strict mode.
- Provider-agnostic: no hardcoded Anthropic/OpenAI SDK in business logic.
- Keep AI boundary (boundary.ts) dependency-free (no LLM imports there).
- Russian comments/copy where user-facing.
- Match existing lib/ai/boundary.ts patterns.

### Boundaries

**Always:**
- AI enrichment writes to separate fields/table, NEVER overwrites source evidence.
- `assertNoOverride` guard stays active.
- Cost tracking logs every LLM call.
- Provider adapter is swappable (config-driven).

**Ask first:**
- Adding a new AI capability not in the original Stage-1 contract (update AI_CAPABILITIES in boundary.ts).
- Deploying full Crawl4AI/ScrapeGraphAI Python services (define interface now, deploy later OK).
- Making AI-enriched fields visible on lead cards (confirm UX treatment first).

**Never:**
- Let AI override score, gate, or evidence.
- Hardcode Anthropic SDK or OpenAI SDK directly in business logic.
- Store AI-generated data in source evidence fields without clear provenance.
- Skip cost tracking for any LLM call.

---

## Tech Stack

**Backend:**
- Next.js 14+ (App Router, Server Components, Server Actions)
- PostgreSQL (existing schema + new ai_usage_log, org_enrichments tables)
- Node.js (existing session.ts, getOwnerIdFromSession)

**AI/LLM:**
- Custom API (OPENAI_BASE_URL + OPENAI_API_KEY from .env) — vendor-agnostic, supports multiple models
- Crawl4AI (external HTTP service, Python-based) — clean markdown from career pages
- ScrapeGraphAI (external HTTP service, Python-based) — structured extraction from weak pages
- n8n workflows (orchestration, enrichment automation)

**Frontend (out of scope for these tasks):**
- React (existing lead views)

**Testing:**
- Jest (unit tests)
- Playwright (optional E2E for owner isolation)

---

## Commands (Definition of Done)

### Task 1 — Multi-tenant Hardening

**Implementation:**
1. Extend read-function signatures: add `ownerId` param.
2. Add `WHERE owner_id = $1` to all user-facing read queries.
3. Resolve `ownerId` in pages via `getOwnerIdFromSession()`.
4. Write owner-isolation unit tests.

**Validation:**
```bash
npm run web:check          # typecheck
npm test                   # full suite green
```

**Commit message template:**
```
feat(auth): owner-scoping for all user-facing reads

Add ownerId param to getLeadDetail, getLeadsForAllProfiles, listClientProfiles,
getClientProfileById, getPendingReviewCount. Pages resolve ownerId from session
and pass to reads. WHERE owner_id = $1 guard prevents IDOR.

Tests: user A cannot read user B's profile/fit/digest data via any read path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Ship:**
- Commit and push before starting Task 2.
- Update memory: multi-tenant hardening complete, all reads owner-scoped.

### Task 2 — Stage-2 AI-assist

**Implementation:**
1. Wire LLM provider adapter (custom API).
2. Implement at least one enrichment path (missing industry classification OR career-page extraction).
3. Create `org_enrichments` + `ai_usage_log` tables.
4. Define Crawl4AI/ScrapeGraphAI interfaces (deployment optional).
5. Create `/api/ai/enrich` endpoint for n8n workflows.
6. Write provider/enrichment/cost-tracking tests.

**Validation:**
```bash
npm run web:check          # typecheck
npm test                   # full suite green, assertNoOverride holds
```

**Commit strategy:**
- Commit 1: Provider adapter + cost tracking
- Commit 2: Enrichment storage (new tables + schema)
- Commit 3: First enrichment path (classify-industry OR extract-jobs)
- Commit 4: n8n enrichment endpoint
- Commit 5: Scraper interfaces (Crawl4AI, ScrapeGraphAI)

**Commit message template (example for Commit 1):**
```
feat(ai): Stage-2 provider adapter + cost tracking

Wire vendor-agnostic LLM provider adapter to custom API (OPENAI_BASE_URL).
Add ai_usage_log table for token/cost tracking. Provider is swappable via config.

assertNoOverride guard from Stage-1 boundary stays active.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Ship:**
- Commit each logical unit separately.
- Update memory: Stage-2 AI-assist complete, provider wired, enrichment integration points ready.
- Document in memory: which enrichment capabilities are ready for n8n workflow use.

---

## Success Metrics

**Task 1:**
- Zero IDOR vulnerabilities in user-facing read paths (tested).
- All reads require ownerId, pages resolve it from session.
- Full test suite green, committed and pushed.

**Task 2:**
- Vendor-agnostic LLM provider wired to custom API.
- At least one enrichment path improving lead quality/quantity (not just copywriting).
- AI-enriched data stored separately from source evidence with clear provenance.
- Cost tracking: every LLM call logged in ai_usage_log.
- n8n enrichment endpoint ready for workflow integration.
- Full test suite green, assertNoOverride holds.

---

**END OF SPEC**
