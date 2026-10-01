/**
 * D3 opener-draft store tests — persistence discipline for the ai_opener_draft
 * column (feature D3, owner directive 2026-10-01).
 *
 * Contract under test:
 *   - every write names ONLY digest_candidates.ai_opener_draft — no path to the
 *     deterministic core (total_score / confidence_gate / reasons /
 *     evidence_titles / opener).
 *   - editing after confirmation RESETS status → 'draft' and confirmedAt → null
 *     (the copied text must equal the text the human last confirmed).
 *   - confirmation flips ONLY status + confirmedAt (it never touches the text).
 *   - the parser is defensive: NULL / malformed / array / missing-draft rows
 *     degrade to null, an unknown status degrades to 'draft' (the safe state).
 */

import { getPool } from '@/lib/db-pool';
import {
  applyOpenerDraftConfirmation,
  applyOpenerDraftEdits,
  OPENER_DRAFT_SCHEMA_VERSION,
  parseStoredOpenerDraft,
  persistGeneratedOpenerDraft,
  readOpenerDraftForCandidate,
  toStoredOpenerDraft,
  type StoredOpenerDraft,
} from '@/lib/ai/opener/openerDraftStore';

jest.mock('@/lib/db-pool', () => ({ getPool: jest.fn() }));

const mockGetPool = jest.mocked(getPool);

const PROVENANCE = {
  draft: 'Здравствуйте! По ООО Ромашка видно, что идёт найм.',
  provider: 'codexoid',
  model: 'codexoid/test-model',
  promptVersion: 'opener-draft-v1',
  traceId: 'trace-1',
};

const FORBIDDEN_COLUMNS = ['total_score', 'confidence_gate', 'evidence_titles', 'SET opener', 'review_status', 'feedback'];

function mockQuery(impl: (sql: string, params?: unknown[]) => Promise<{ rows?: unknown[]; rowCount?: number }>) {
  const query = jest.fn(impl);
  mockGetPool.mockReturnValue({ query } as never);
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPool.mockReturnValue(null);
});

describe('toStoredOpenerDraft', () => {
  it('stamps schema version, draft lifecycle fields and provenance', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    const stored = toStoredOpenerDraft(PROVENANCE, now);
    expect(stored).not.toBeNull();
    expect(stored?.schemaVersion).toBe(OPENER_DRAFT_SCHEMA_VERSION);
    expect(stored?.draft).toBe(PROVENANCE.draft);
    expect(stored?.currentText).toBe(PROVENANCE.draft);
    expect(stored?.status).toBe('draft');
    expect(stored?.generatedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(stored?.editedAt).toBeNull();
    expect(stored?.confirmedAt).toBeNull();
    expect(stored?.provider).toBe('codexoid');
    expect(stored?.model).toBe('codexoid/test-model');
    expect(stored?.traceId).toBe('trace-1');
  });

  it('returns null for an empty draft (column stays NULL)', () => {
    expect(toStoredOpenerDraft({ ...PROVENANCE, draft: '   ' })).toBeNull();
  });
});

describe('parseStoredOpenerDraft', () => {
  it('round-trips a stored payload', () => {
    const stored = toStoredOpenerDraft(PROVENANCE)!;
    expect(parseStoredOpenerDraft(stored)).toEqual(stored);
  });

  it('parses a JSON string column value', () => {
    const stored = toStoredOpenerDraft(PROVENANCE)!;
    expect(parseStoredOpenerDraft(JSON.stringify(stored))?.traceId).toBe('trace-1');
  });

  it('returns null for NULL / undefined / malformed JSON / arrays', () => {
    expect(parseStoredOpenerDraft(null)).toBeNull();
    expect(parseStoredOpenerDraft(undefined)).toBeNull();
    expect(parseStoredOpenerDraft('not json{{{')).toBeNull();
    expect(parseStoredOpenerDraft([1, 2, 3])).toBeNull();
  });

  it('returns null when the draft text is missing or blank', () => {
    expect(parseStoredOpenerDraft({ currentText: 'x', status: 'confirmed' })).toBeNull();
    expect(parseStoredOpenerDraft({ draft: '  ' })).toBeNull();
  });

  it('degrades an unknown status to draft and falls back currentText → draft', () => {
    const parsed = parseStoredOpenerDraft({ draft: 'Текст', status: 'sent' });
    expect(parsed?.status).toBe('draft');
    expect(parsed?.currentText).toBe('Текст');
    expect(parsed?.schemaVersion).toBe(0); // unknown legacy shape
    expect(parsed?.confirmedAt).toBeNull();
  });
});

describe('persistGeneratedOpenerDraft', () => {
  it('writes ONLY the ai_opener_draft column, addressed by candidate id', async () => {
    const query = mockQuery(async () => ({ rowCount: 1 }));
    const stored = toStoredOpenerDraft(PROVENANCE)!;

    const updated = await persistGeneratedOpenerDraft({ candidateId: '55', draft: stored });

    expect(updated).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/SET\s+ai_opener_draft\s+=\s+\$1::jsonb/);
    expect(String(sql)).toContain('WHERE id = $2');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(String(sql)).not.toContain(forbidden);
    }
    expect(params).toEqual([JSON.stringify(stored), '55']);
  });

  it('is a no-op without a pool (never throws)', async () => {
    expect(await persistGeneratedOpenerDraft({ candidateId: '55', draft: toStoredOpenerDraft(PROVENANCE)! })).toBe(0);
  });
});

describe('readOpenerDraftForCandidate', () => {
  it('reads the single column and parses it', async () => {
    const stored = toStoredOpenerDraft(PROVENANCE)!;
    const query = mockQuery(async () => ({ rows: [{ ai_opener_draft: stored }], rowCount: 1 }));
    const parsed = await readOpenerDraftForCandidate('55');
    expect(parsed).toEqual(stored);
    expect(String(query.mock.calls[0][0])).toContain('SELECT ai_opener_draft FROM digest_candidates WHERE id = $1');
  });

  it('returns null when the row/column is absent', async () => {
    mockQuery(async () => ({ rows: [{ ai_opener_draft: null }], rowCount: 1 }));
    expect(await readOpenerDraftForCandidate('55')).toBeNull();
  });
});

describe('applyOpenerDraftEdits', () => {
  it('merges only the lifecycle keys and RESETS a previous confirmation', async () => {
    const edited: StoredOpenerDraft = {
      ...toStoredOpenerDraft(PROVENANCE)!,
      currentText: 'Отредактированный текст',
      status: 'draft',
      editedAt: '2026-10-01T12:05:00.000Z',
      confirmedAt: null,
    };
    const query = mockQuery(async () => ({ rows: [{ ai_opener_draft: edited }], rowCount: 1 }));

    const result = await applyOpenerDraftEdits({
      candidateId: '55',
      currentText: 'Отредактированный текст',
      now: new Date('2026-10-01T12:05:00.000Z'),
    });

    expect(result?.status).toBe('draft');
    expect(result?.confirmedAt).toBeNull();
    expect(result?.currentText).toBe('Отредактированный текст');

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/SET\s+ai_opener_draft\s+=\s+ai_opener_draft\s+\|\|\s+jsonb_build_object/);
    expect(sql).toContain("'currentText', $1::text");
    expect(sql).toContain("'status', 'draft'");
    expect(sql).toContain("'confirmedAt', NULL::text");
    expect(sql).toContain('RETURNING ai_opener_draft');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('returns null when there is no draft to edit (rowCount 0)', async () => {
    mockQuery(async () => ({ rows: [], rowCount: 0 }));
    expect(await applyOpenerDraftEdits({ candidateId: '55', currentText: 'x' })).toBeNull();
  });
});

describe('applyOpenerDraftConfirmation', () => {
  it('flips ONLY status + confirmedAt — the text is untouched', async () => {
    const confirmed: StoredOpenerDraft = {
      ...toStoredOpenerDraft(PROVENANCE)!,
      status: 'confirmed',
      confirmedAt: '2026-10-01T12:10:00.000Z',
    };
    const query = mockQuery(async () => ({ rows: [{ ai_opener_draft: confirmed }], rowCount: 1 }));

    const result = await applyOpenerDraftConfirmation({
      candidateId: '55',
      now: new Date('2026-10-01T12:10:00.000Z'),
    });

    expect(result?.status).toBe('confirmed');
    expect(result?.confirmedAt).toBe('2026-10-01T12:10:00.000Z');
    expect(result?.currentText).toBe(PROVENANCE.draft);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("'status', 'confirmed'");
    expect(sql).toContain("'confirmedAt', $1::text");
    expect(sql).not.toContain('currentText');
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('returns null when there is no draft to confirm', async () => {
    mockQuery(async () => ({ rows: [], rowCount: 0 }));
    expect(await applyOpenerDraftConfirmation({ candidateId: '55' })).toBeNull();
  });
});
