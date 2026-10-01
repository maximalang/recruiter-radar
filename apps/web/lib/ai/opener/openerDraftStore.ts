/**
 * Persistence for the D3 AI opener draft — the bridge between the text an
 * operator-triggered LLM generation produces and the `ai_opener_draft` JSONB
 * column on `digest_candidates`.
 *
 * Why a dedicated module: the opener draft is a SEPARATE, attributed layer
 * (boundary.ts `draft-opener` capability). It is written only after an explicit
 * user action on the lead detail page and read back as an editable draft. It
 * must never touch the deterministic columns (total_score, confidence_gate,
 * reasons, evidence_titles, opener) — so every write here is a targeted
 * `UPDATE ... SET ai_opener_draft = ...` that names only that column, and the
 * read is a single-column SELECT. There is no path from this module to the
 * score/gate, and NO path to any send/delivery surface: confirming a draft
 * only flips `status` so the UI exposes a manual clipboard copy.
 *
 * Stored shape (schema-versioned so a future change is detectable):
 *   StoredOpenerDraft — see the interface below and the column COMMENT in
 *   packages/db/migrations/20261001220000_add_digest_candidate_ai_opener_draft.sql
 *
 * All functions degrade to a no-op / null when there is no pool or the payload
 * is unusable — persistence can never break a scoring run or a page render.
 */

import { getPool } from '../../db-pool';

/** Bump when the stored shape changes in a non-additive way. */
export const OPENER_DRAFT_SCHEMA_VERSION = 1 as const;

/** Lifecycle of a stored draft. `confirmed` only ever unlocks a manual copy. */
export const OPENER_DRAFT_STATUSES = ['draft', 'confirmed'] as const;
export type OpenerDraftStatus = (typeof OPENER_DRAFT_STATUSES)[number];

/** The exact JSON persisted in `digest_candidates.ai_opener_draft`. */
export interface StoredOpenerDraft {
  schemaVersion: number;
  /** The original AI-generated text (immutable after generation). */
  draft: string;
  /** The text with operator edits applied — what confirm/copy operate on. */
  currentText: string;
  status: OpenerDraftStatus;
  /** Provider attribution for the UI/log (e.g. 'codexoid' | 'openai'). */
  provider: string;
  /** Model name used for the generation. */
  model: string;
  /** Prompt contract version (see openerDraftProvider.OPENER_DRAFT_PROMPT_VERSION). */
  promptVersion: string;
  /** Correlation id tying the stored draft to the ai.opener.api_call log line. */
  traceId: string;
  /** ISO-8601 timestamp the draft was generated. */
  generatedAt: string;
  /** ISO-8601 timestamp of the last operator edit, null when never edited. */
  editedAt: string | null;
  /** ISO-8601 timestamp of the human confirmation, null while unconfirmed. */
  confirmedAt: string | null;
}

/** Provenance a fresh generation carries into the stored payload. */
export interface OpenerDraftProvenance {
  draft: string;
  provider: string;
  model: string;
  promptVersion: string;
  traceId: string;
}

/**
 * Build the stored payload from a successful generation. Returns null when the
 * generated text is unusable (empty after trim) — callers then skip the write
 * entirely, so a NULL column always means "no draft".
 */
export function toStoredOpenerDraft(
  provenance: OpenerDraftProvenance,
  now: Date = new Date(),
): StoredOpenerDraft | null {
  const draft = provenance.draft.trim();
  if (!draft) return null;
  const generatedAt = now.toISOString();
  return {
    schemaVersion: OPENER_DRAFT_SCHEMA_VERSION,
    draft,
    currentText: draft,
    status: 'draft',
    provider: provenance.provider,
    model: provenance.model,
    promptVersion: provenance.promptVersion,
    traceId: provenance.traceId,
    generatedAt,
    editedAt: null,
    confirmedAt: null,
  };
}

/**
 * Parse a raw `ai_opener_draft` column value back into a `StoredOpenerDraft`.
 * Defensive: returns null for NULL, malformed JSON, or a shape missing the
 * draft text. Never throws — a bad row renders the page without the block
 * instead of crashing. An unknown `status` degrades to 'draft' (the safe state:
 * the manual-copy affordance requires an explicit confirmation).
 */
export function parseStoredOpenerDraft(raw: unknown): StoredOpenerDraft | null {
  if (raw === null || raw === undefined) return null;

  // node-postgres returns JSONB as a parsed object; tolerate a string too.
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;

  const o = obj as Record<string, unknown>;
  if (typeof o.draft !== 'string' || o.draft.trim().length === 0) return null;
  const currentText =
    typeof o.currentText === 'string' && o.currentText.trim().length > 0
      ? o.currentText
      : o.draft;
  const status: OpenerDraftStatus = o.status === 'confirmed' ? 'confirmed' : 'draft';

  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 0,
    draft: o.draft,
    currentText,
    status,
    provider: typeof o.provider === 'string' ? o.provider : '',
    model: typeof o.model === 'string' ? o.model : '',
    promptVersion: typeof o.promptVersion === 'string' ? o.promptVersion : '',
    traceId: typeof o.traceId === 'string' ? o.traceId : '',
    generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : '',
    editedAt: typeof o.editedAt === 'string' ? o.editedAt : null,
    confirmedAt: typeof o.confirmedAt === 'string' ? o.confirmedAt : null,
  };
}

/**
 * Persist a freshly generated draft onto a digest candidate, addressed by its
 * primary key. Writes ONLY the ai_opener_draft column; no other column is
 * named, so it cannot disturb the deterministic core. No-op when there is no
 * pool. Returns the number of rows updated (0 when the candidate is gone).
 */
export async function persistGeneratedOpenerDraft(input: {
  candidateId: string | number;
  draft: StoredOpenerDraft;
}): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;

  const result = await pool.query(
    `UPDATE digest_candidates
        SET ai_opener_draft = $1::jsonb
      WHERE id = $2`,
    [JSON.stringify(input.draft), input.candidateId],
  );
  return result.rowCount ?? 0;
}

/** Read the stored draft for a candidate. Null when absent/unusable/no pool. */
export async function readOpenerDraftForCandidate(
  candidateId: string | number,
): Promise<StoredOpenerDraft | null> {
  const pool = getPool();
  if (!pool) return null;
  const result = await pool.query(
    `SELECT ai_opener_draft FROM digest_candidates WHERE id = $1`,
    [candidateId],
  );
  if (result.rowCount !== 1) return null;
  return parseStoredOpenerDraft(result.rows[0]?.ai_opener_draft);
}

/**
 * Apply an operator edit to the stored draft. Editing text after confirmation
 * RESETS the confirmation (status → 'draft', confirmedAt → NULL) — a human must
 * re-confirm the exact text they are about to copy. The merge touches only the
 * four draft-lifecycle keys; generation provenance (draft, provider, model,
 * promptVersion, traceId, generatedAt) is preserved. Returns the updated stored
 * draft, or null when there is no draft/pool to update.
 */
export async function applyOpenerDraftEdits(input: {
  candidateId: string | number;
  currentText: string;
  now?: Date;
}): Promise<StoredOpenerDraft | null> {
  const pool = getPool();
  if (!pool) return null;

  const editedAt = (input.now ?? new Date()).toISOString();
  const result = await pool.query(
    `UPDATE digest_candidates
        SET ai_opener_draft = ai_opener_draft || jsonb_build_object(
              'currentText', $1::text,
              'status', 'draft',
              'editedAt', $2::text,
              'confirmedAt', NULL::text)
      WHERE id = $3
        AND ai_opener_draft IS NOT NULL
      RETURNING ai_opener_draft`,
    [input.currentText, editedAt, input.candidateId],
  );
  if (result.rowCount !== 1) return null;
  return parseStoredOpenerDraft(result.rows[0]?.ai_opener_draft);
}

/**
 * Record the human confirmation of the current draft text. This is the ONLY
 * thing confirmation does: it flips `status` to 'confirmed' and stamps
 * `confirmedAt`, which unlocks the manual clipboard copy in the UI. It never
 * touches `currentText`, never calls any provider, and never sends anything
 * (boundary.ts `auto-send` prohibition). Returns the updated stored draft, or
 * null when there is no draft/pool to confirm.
 */
export async function applyOpenerDraftConfirmation(input: {
  candidateId: string | number;
  now?: Date;
}): Promise<StoredOpenerDraft | null> {
  const pool = getPool();
  if (!pool) return null;

  const confirmedAt = (input.now ?? new Date()).toISOString();
  const result = await pool.query(
    `UPDATE digest_candidates
        SET ai_opener_draft = ai_opener_draft || jsonb_build_object(
              'status', 'confirmed',
              'confirmedAt', $1::text)
      WHERE id = $2
        AND ai_opener_draft IS NOT NULL
      RETURNING ai_opener_draft`,
    [confirmedAt, input.candidateId],
  );
  if (result.rowCount !== 1) return null;
  return parseStoredOpenerDraft(result.rows[0]?.ai_opener_draft);
}
