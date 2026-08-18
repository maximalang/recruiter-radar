import { createSignalContract } from '@/lib/intelligence/signal-contract';

describe('SignalContract', () => {
  it('preserves the Signal → Why now → Evidence → Confidence → Action boundary', () => {
    const contract = createSignalContract({
      signal: '87',
      whyNow: 'Найм ускорился за последние дни',
      evidence: [{ proof: 'Открыта вакансия Head of Sales', source: 'career-page' }],
      confidence: { gate: 'B', label: 'достаточная' },
      action: 'Проверить подтверждения',
      timestamp: '2026-08-18T10:00:00.000Z',
    });

    expect(contract).toMatchObject({
      signal: '87',
      whyNow: 'Найм ускорился за последние дни',
      confidence: { gate: 'B', label: 'достаточная' },
      action: 'Проверить подтверждения',
    });
    expect(contract.evidence).toEqual([
      { proof: 'Открыта вакансия Head of Sales', source: 'career-page' },
    ]);
  });

  it('does not require invented source or timestamp provenance for projected evidence', () => {
    const contract = createSignalContract({
      signal: '42',
      whyNow: 'Требуется ручная проверка',
      evidence: [{ proof: 'Senior backend engineer' }],
      confidence: { label: 'требует проверки' },
      action: 'Открыть компанию',
    });

    expect(contract.evidence[0]).toEqual({ proof: 'Senior backend engineer' });
  });
});
