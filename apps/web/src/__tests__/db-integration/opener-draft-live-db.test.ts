/**
 * D3 opener draft — LIVE dev-env generation evidence (real lead → real LLM
 * draft → confirm against a real PostgreSQL).
 *
 * SELF-SKIPS everywhere unless explicitly armed — CI and regular `npm test`
 * never touch a database or a provider. Arming (dev machine only):
 *   OPENER_DRAFT_LIVE_DB_ACK=isolated  — the target DATABASE_URL is a local /
 *                                        isolated dev database, not production.
 *   OPENER_DRAFT_LIVE_LLM=true         — allow ONE real paid-provider call.
 *   RR_LIVE_ENV_DIR=<repo checkout>    — optional; a checkout whose root env
 *                                        files provide DATABASE_URL / LLM
 *                                        config. Values are loaded into
 *                                        process.env only and are NEVER
 *                                        printed; the evidence line below is
 *                                        sanitized (provider, model, traceId,
 *                                        timestamps, draft text = corporate
 *                                        facts, no keys, no URLs).
 *
 * The run mutates exactly one dev-DB row (digest_candidates.ai_opener_draft of
 * the picked candidate) and leaves the confirmed draft in place as evidence.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { Pool } from 'pg';

import { getClientProfileById } from '@/lib/clientProfiles';
import { getLeadDetail } from '@/lib/leads-data';
import { deriveRoleNames } from '@/lib/leads/lead-quality';
import { draftOpener, MAX_OPENER_DRAFT_CHARS } from '@/lib/ai/opener/openerDraftProvider';
import { isLlmConfigured, resolveLlmProviderConfig } from '@/lib/ai/providers/llm-config';
import { ensureLlmOverridesLoaded } from '@/lib/operatorSettings';
import {
  applyOpenerDraftConfirmation,
  applyOpenerDraftEdits,
  OPENER_DRAFT_SCHEMA_VERSION,
  parseStoredOpenerDraft,
  persistGeneratedOpenerDraft,
  toStoredOpenerDraft,
} from '@/lib/ai/opener/openerDraftStore';

// leads-data reads the pool via lib/db, which jest.setup stubs to null for the
// whole suite. In this armed live run we delegate that stub to the real shared
// pool so the production reader path is exercised exactly as in the app.
jest.mock('lib/db', () => {
  const shared = jest.requireActual<{ getPool: () => unknown }>('@/lib/db-pool');
  return { __esModule: true, getPool: () => shared.getPool() };
});

/** Minimal KEY=*** loader for the checkout's root env files. Never logs. */
function loadRootEnvFiles(dir: string): void {
  for (const name of ['.env.local', '.env']) {
    let text: string;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      let value = rawValue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

const envDir = process.env.RR_LIVE_ENV_DIR?.trim();
if (envDir) loadRootEnvFiles(envDir);

const databaseUrl = process.env.DATABASE_URL?.trim();
const armed =
  Boolean(databaseUrl) &&
  process.env.OPENER_DRAFT_LIVE_DB_ACK === 'isolated' &&
  process.env.OPENER_DRAFT_LIVE_LLM === 'true';
const describeIfArmed = armed ? describe : describe.skip;

describeIfArmed('D3 opener draft — live dev-env generation (armed only)', () => {
  let pool: Pool;

  beforeAll(async () => {
    jest.setTimeout(180_000);
    pool = new Pool({ connectionString: databaseUrl });
    // Mirror the D3 migration idempotently so an unmigrated dev DB works too
    // (npm run db:migrate stays authoritative and re-application is a no-op).
    await pool.query(`ALTER TABLE digest_candidates ADD COLUMN IF NOT EXISTS ai_opener_draft JSONB`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('runs a real lead → draft → edit → confirm cycle with the configured provider', async () => {
    const pick = await pool.query<{ id: string; owner_id: string }>(
      `SELECT dc.id::TEXT AS id, cp.owner_id::TEXT AS owner_id
         FROM digest_candidates dc
         JOIN client_profiles cp ON cp.id = dc.client_profile_id
        WHERE dc.source_display_name IS NOT NULL
          AND dc.source_display_name <> ''
        ORDER BY dc.total_score DESC NULLS LAST, dc.id DESC
        LIMIT 1`,
    );
    if (pick.rowCount === 0) {
      console.warn('[D3-LIVE] dev DB has no digest candidates — nothing to generate for.');
      return;
    }
    const { id: candidateId, owner_id: ownerId } = pick.rows[0];

    // Clean slate for this evidence run (single row, dev DB only).
    await pool.query(`UPDATE digest_candidates SET ai_opener_draft = NULL WHERE id = $1`, [candidateId]);

    const lead = await getLeadDetail({ candidateId, ownerId });
    expect(lead).not.toBeNull();
    expect(lead!.aiOpenerDraft).toBeNull();

    // Prime the operator DB overrides exactly like the app boot does — the
    // admin-panel LLM config (operator_settings) wins over env, and the dev DB
    // may carry the key there instead of an env file.
    await ensureLlmOverridesLoaded();
    expect(isLlmConfigured()).toBe(true);
    const config = resolveLlmProviderConfig();

    const profile = await getClientProfileById(lead!.clientProfileId, ownerId);
    const contactPolicy =
      profile?.contactPolicy === 'no_personal' || profile?.contactPolicy === 'unrestricted'
        ? profile.contactPolicy
        : 'corporate_only';

    const result = await draftOpener(
      {
        orgName: lead!.orgName,
        reasons: lead!.reasons.slice(0, 4),
        roleNames: deriveRoleNames({
          evidenceTitles: lead!.evidenceTitles,
          aiRoleTitles: null,
        }).slice(0, 6),
        contactPolicy,
      },
      { orgId: lead!.orgId },
    );

    expect(result.note ?? null).toBeNull();
    expect(result.available).toBe(true);
    const data = result.data!;
    expect(data.draft.length).toBeGreaterThan(0);
    expect(data.draft.length).toBeLessThanOrEqual(MAX_OPENER_DRAFT_CHARS);

    const stored = toStoredOpenerDraft({
      draft: data.draft,
      provider: result.provider,
      model: data.model,
      promptVersion: data.promptVersion,
      traceId: data.traceId,
    })!;
    const updatedRows = await persistGeneratedOpenerDraft({ candidateId, draft: stored });
    expect(updatedRows).toBe(1);

    // The production reader projects the stored draft onto the lead detail.
    const reread = await getLeadDetail({ candidateId, ownerId });
    expect(reread?.aiOpenerDraft?.traceId).toBe(data.traceId);
    expect(reread?.aiOpenerDraft?.status).toBe('draft');
    expect(reread?.aiOpenerDraft?.schemaVersion).toBe(OPENER_DRAFT_SCHEMA_VERSION);

    const editText =
      data.draft.length > MAX_OPENER_DRAFT_CHARS - 20
        ? data.draft.slice(0, MAX_OPENER_DRAFT_CHARS - 20)
        : `${data.draft} (правка оператора)`;
    const edited = await applyOpenerDraftEdits({ candidateId, currentText: editText });
    expect(edited?.status).toBe('draft');
    expect(edited?.currentText).toBe(editText);
    expect(edited?.confirmedAt).toBeNull();

    const confirmed = await applyOpenerDraftConfirmation({ candidateId });
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.confirmedAt).toBeTruthy();
    expect(confirmed?.currentText).toBe(editText);

    const raw = await pool.query(`SELECT ai_opener_draft FROM digest_candidates WHERE id = $1`, [candidateId]);
    const parsed = parseStoredOpenerDraft(raw.rows[0]?.ai_opener_draft);
    expect(parsed?.status).toBe('confirmed');
    expect(parsed?.draft).toBe(data.draft);

    // Sanitized evidence line (corporate facts + attribution only; no secrets).
    console.info(
      '[D3-LIVE-EVIDENCE] ' +
        JSON.stringify(
          {
            at: new Date().toISOString(),
            candidateId,
            orgName: lead!.orgName,
            contactPolicy,
            provider: result.provider,
            baseUrlProvider: config.provider,
            model: data.model,
            promptVersion: data.promptVersion,
            traceId: data.traceId,
            tokensUsed: data.tokensUsed,
            generatedAt: stored.generatedAt,
            editedAt: edited?.editedAt ?? null,
            confirmedAt: confirmed?.confirmedAt ?? null,
            draftChars: stored.draft.length,
            currentTextChars: parsed?.currentText.length ?? 0,
            draftText: stored.draft,
            currentText: parsed?.currentText ?? null,
          },
          null,
          2,
        ),
    );
  });
});
