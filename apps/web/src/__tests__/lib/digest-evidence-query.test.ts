import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DIGEST_EVIDENCE_QUERY } from '@/lib/digest-evidence-query'

// Guards against drift between the canonical SQL file and the inlined TS mirror.
// The mirror exists because Next.js's standalone tracer cannot bundle a file read
// via a dynamic readFileSync path. If this fails, re-run
// scripts/sync-digest-evidence-query.mjs after editing the .sql.
describe('digest evidence query mirror', () => {
  it('matches packages/db/scripts/source-digest-evidence.sql byte-for-byte', () => {
    const sqlPath = resolve(__dirname, '../../../../../packages/db/scripts/source-digest-evidence.sql')
    const canonical = readFileSync(sqlPath, 'utf8')
    expect(DIGEST_EVIDENCE_QUERY).toBe(canonical)
  })

  it('projects exact source signal and evidence lineage into every digest candidate', () => {
    expect(DIGEST_EVIDENCE_QUERY).toContain('signal.id AS signal_id')
    expect(DIGEST_EVIDENCE_QUERY).toContain('lineage.evidence_id')
    expect(DIGEST_EVIDENCE_QUERY).toContain('AS source_signal_ids')
    expect(DIGEST_EVIDENCE_QUERY).toContain('AS source_evidence_ids')
    expect(DIGEST_EVIDENCE_QUERY).toContain('AS source_record_external_ids')
    expect(DIGEST_EVIDENCE_QUERY).toContain('AS source_record_urls')
  })

  it('canonicalizes already-prefixed legal identity keys without duplicating the namespace', () => {
    expect(DIGEST_EVIDENCE_QUERY).toContain("'inn:' || LOWER(REPLACE(ref.source_key, 'inn:', ''))")
    expect(DIGEST_EVIDENCE_QUERY).toContain("'ogrn:' || LOWER(REPLACE(ref.source_key, 'ogrn:', ''))")
    expect(DIGEST_EVIDENCE_QUERY).not.toContain("'inn:' || ref.source_key")
    expect(DIGEST_EVIDENCE_QUERY).not.toContain("'ogrn:' || ref.source_key")
  })

  // Regression guard for a prod-only HTTP 500 (PostgreSQL 42601 "syntax error at
  // or near \"FILTER\"") caused by writing an aggregate FILTER clause INSIDE the
  // aggregate's argument parentheses:
  //   ARRAY_AGG(DISTINCT expr FILTER (WHERE ...))   ← INVALID: FILTER is inside ()
  //   ARRAY_AGG(DISTINCT expr) FILTER (WHERE ...)    ← valid: FILTER follows the )
  // Per the Postgres grammar, the FILTER clause must sit OUTSIDE the
  // aggregate-call argument list — immediately after its closing parenthesis.
  //
  // A naive "char before FILTER is ')'" check is fooled because the arg itself
  // ends in ')' (e.g. NULLIF(..., '')), so we instead assert that the token
  // immediately preceding the FILTER clause is a ')' whose matching '(' opens an
  // aggregate call (ARRAY_AGG/COUNT/MIN/MAX/SUM/STRING_AGG/BOOL_AND/BOOL_OR/etc).
  // For each FILTER we walk back over whitespace+newlines to the nearest non-
  // whitespace char (must be ')'), then find its matching '(' and check the
  // function name abutting that '(' is a known SQL aggregate. Anything else is a
  // misplaced FILTER.
  it('every FILTER (WHERE ...) clause attaches to an aggregate call (not inside its args)', () => {
    const sql = DIGEST_EVIDENCE_QUERY
    const aggregates = new Set([
      'array_agg', 'count', 'min', 'max', 'sum', 'avg',
      'string_agg', 'bool_and', 'bool_or', 'every', 'jsonb_agg', 'jsonb_object_agg',
      'json_agg', 'json_object_agg', 'xmlagg', 'corr', 'covar_samp', 'covar_pop',
      'stddev', 'stddev_samp', 'stddev_pop', 'variance', 'var_samp', 'var_pop',
      'regr_avgx', 'regr_avgy', 'regr_slope', 'regr_intercept', 'rank', 'dense_rank',
      'percent_rank', 'cume_dist', 'percentile_cont', 'percentile_disc', 'mode',
      'first_value', 'last_value', 'nth_value', 'grouping', 'ordered_set_agg',
    ])

    const offenders: string[] = []
    const filterRe = /\bFILTER\s*\(\s*WHERE/gi
    let m: RegExpExecArray | null
    while ((m = filterRe.exec(sql)) !== null) {
      const filterStart = m.index
      // Walk back over whitespace to the nearest non-whitespace char.
      let i = filterStart - 1
      while (i >= 0 && /\s/.test(sql[i])) i--
      if (i < 0 || sql[i] !== ')') {
        offenders.push(`FILTER at offset ${filterStart} is not preceded by ')'`)
        continue
      }
      // Find the '(' matching this ')'.
      let depth = 1
      let j = i - 1
      while (j >= 0 && depth > 0) {
        if (sql[j] === ')') depth++
        else if (sql[j] === '(') depth--
        j--
      }
      if (depth !== 0) {
        offenders.push(`FILTER at offset ${filterStart}: unbalanced parens walking back`)
        continue
      }
      // j+1 is the '('; the function name is the identifier (with optional
      // trailing whitespace) immediately before it.
      let k = j // j is one before '('
      while (k >= 0 && /\s/.test(sql[k])) k--
      let name = ''
      while (k >= 0 && /[A-Za-z0-9_]/.test(sql[k])) {
        name = sql[k] + name
        k--
      }
      if (!aggregates.has(name.toLowerCase())) {
        offenders.push(
          `FILTER at offset ${filterStart} attaches to "${name}" which is not a known aggregate. ` +
            `Context: ${JSON.stringify(sql.slice(Math.max(0, filterStart - 80), filterStart + 40))}`,
        )
      }
    }
    expect(offenders).toEqual([])
  })
})
