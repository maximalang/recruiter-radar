import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('digest candidate lineage persistence contract', () => {
  const source = readFileSync(resolve(__dirname, '../../../lib/digest.ts'), 'utf8')

  it('re-projects exact lineage through both ranked-candidate wrappers', () => {
    for (const field of [
      'source_signal_ids',
      'source_evidence_ids',
      'source_record_external_ids',
      'source_record_urls',
    ]) {
      expect(source.match(new RegExp(`ranked_candidates\\.${field}`, 'g'))).toHaveLength(2)
    }
  })

  it('normalizes and persists exact lineage in digest_candidates.payload', () => {
    expect(source).toContain('source_signal_ids: sourceSignalIds')
    expect(source).toContain('source_evidence_ids: sourceEvidenceIds')
    expect(source).toContain('source_record_external_ids: sourceRecordExternalIds')
    expect(source).toContain('source_record_urls: sourceRecordUrls')
    expect(source).toContain('source_signal_ids: item.source_signal_ids ?? []')
    expect(source).toContain('source_evidence_ids: item.source_evidence_ids ?? []')
    expect(source).toContain('source_record_external_ids: item.source_record_external_ids ?? []')
    expect(source).toContain('source_record_urls: item.source_record_urls ?? []')
  })
})
