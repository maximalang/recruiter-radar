/**
 * D2 market-profile presets — registry invariants.
 *
 * The frozen landing demo promises a market profile «Инженерный подбор» with
 * ниша / роли / география / признаки спроса. These tests pin that the registry
 * actually contains such a preset, that its criteria are canonical (keys ⊆
 * VALID_ROLES / VALID_INDUSTRIES — the whitelists live in the server-only
 * clientProfiles.ts, which the client-safe registry must not import), and
 * that the resolver round-trips a persisted profile back to its preset.
 */
import {
  MARKET_PROFILE_CUSTOM_CHOICE,
  MARKET_PROFILE_PRESETS,
  buildMarketProfileDraftFromPreset,
  getMarketProfilePresetById,
  normalizeMarketProfilePresetChoice,
  resolveMarketProfilePresetId,
  selectMarketProfilePresetId,
  type MarketProfilePreset,
} from '@/lib/marketProfilePresets';
import { VALID_INDUSTRIES, VALID_ROLES } from '@/lib/clientProfiles';

function requirePreset(id: string): MarketProfilePreset {
  const preset = getMarketProfilePresetById(id);
  if (!preset) throw new Error(`preset not found: ${id}`);
  return preset;
}

describe('MARKET_PROFILE_PRESETS registry (D2)', () => {
  it('contains the «Инженерный подбор» preset shown by the frozen landing demo', () => {
    const engineering = requirePreset('engineering-hiring');
    expect(engineering.label).toBe('Инженерный подбор');
    // Ниша — the specialization text the preset persists.
    expect(engineering.criteria.specialization).toBe('Инженерный подбор');
  });

  it('contains the «Финансовый софт» watch-list preset from the frozen landing', () => {
    const finance = requirePreset('finance-software');
    expect(finance.label).toBe('Финансовый софт');
    expect(finance.criteria.specialization).toBe('Финансовый софт');
  });

  it('every preset covers the four demo criteria dimensions (ниша/роли/география/признаки спроса)', () => {
    for (const preset of MARKET_PROFILE_PRESETS) {
      // Ниша
      expect(preset.criteria.specialization.trim().length).toBeGreaterThan(0);
      // Роли — canonical keys, non-empty
      expect(preset.criteria.roles.length).toBeGreaterThan(0);
      for (const role of preset.criteria.roles) {
        expect(VALID_ROLES.has(role)).toBe(true);
      }
      // Отрасли — canonical keys
      for (const industry of preset.criteria.industries) {
        expect(VALID_INDUSTRIES.has(industry)).toBe(true);
      }
      // География — display label + remote coverage flag
      expect(preset.geographyLabel.trim().length).toBeGreaterThan(0);
      expect(typeof preset.criteria.remoteFriendly).toBe('boolean');
      // Признаки спроса — non-empty phrases
      expect(preset.criteria.demandSignals.length).toBeGreaterThan(0);
      for (const signal of preset.criteria.demandSignals) {
        expect(signal.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('the engineering preset roles/demand signals match the demo story (рост команд, редкие роли, расширение, новые площадки)', () => {
    const engineering = requirePreset('engineering-hiring');
    expect([...engineering.criteria.roles]).toEqual(['it-engineering', 'data']);
    const signals = engineering.criteria.demandSignals.join(' ');
    expect(signals).toContain('инженер');
    expect(signals).toContain('расширение');
    expect(signals).toContain('площадк');
  });

  it('preset ids are unique', () => {
    const ids = MARKET_PROFILE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveMarketProfilePresetId', () => {
  it('resolves the canonical id', () => {
    expect(resolveMarketProfilePresetId('engineering-hiring')).toBe('engineering-hiring');
    expect(resolveMarketProfilePresetId('finance-software')).toBe('finance-software');
  });

  it('resolves the persisted specialization label back to the preset (round-trip)', () => {
    expect(resolveMarketProfilePresetId('Инженерный подбор')).toBe('engineering-hiring');
    expect(resolveMarketProfilePresetId('  инженерный подбор  ')).toBe('engineering-hiring');
    expect(resolveMarketProfilePresetId('Финансовый софт')).toBe('finance-software');
  });

  it('resolves the explicit custom choice and unknown values to null', () => {
    expect(resolveMarketProfilePresetId('custom')).toBeNull();
    expect(resolveMarketProfilePresetId('bogus')).toBeNull();
    expect(resolveMarketProfilePresetId('')).toBeNull();
    expect(resolveMarketProfilePresetId(null)).toBeNull();
    expect(resolveMarketProfilePresetId(undefined)).toBeNull();
  });
});

describe('normalizeMarketProfilePresetChoice', () => {
  it('keeps canonical preset ids (by id or by persisted label)', () => {
    expect(normalizeMarketProfilePresetChoice('engineering-hiring')).toBe('engineering-hiring');
    expect(normalizeMarketProfilePresetChoice('Инженерный подбор')).toBe('engineering-hiring');
    expect(normalizeMarketProfilePresetChoice('Финансовый софт')).toBe('finance-software');
  });

  it('records the explicit custom choice as the distinguishable sentinel', () => {
    expect(normalizeMarketProfilePresetChoice('custom')).toBe(MARKET_PROFILE_CUSTOM_CHOICE);
    expect(normalizeMarketProfilePresetChoice('  CUSTOM ')).toBe(MARKET_PROFILE_CUSTOM_CHOICE);
    expect(MARKET_PROFILE_CUSTOM_CHOICE).toBe('custom');
  });

  it('maps absence/empty/unknown garbage to null (no recorded choice)', () => {
    expect(normalizeMarketProfilePresetChoice(null)).toBeNull();
    expect(normalizeMarketProfilePresetChoice(undefined)).toBeNull();
    expect(normalizeMarketProfilePresetChoice('')).toBeNull();
    expect(normalizeMarketProfilePresetChoice('mass-outreach-preset')).toBeNull();
  });
});

describe('selectMarketProfilePresetId (F-1: custom vs legacy)', () => {
  it('an explicitly recorded custom choice stays custom even when the specialization matches a preset label', () => {
    expect(selectMarketProfilePresetId('custom', 'Инженерный подбор')).toBeNull();
    expect(selectMarketProfilePresetId('custom', 'Финансовый софт')).toBeNull();
  });

  it('a recorded preset id wins over the specialization label', () => {
    expect(selectMarketProfilePresetId('finance-software', 'Инженерный подбор')).toBe('finance-software');
    expect(selectMarketProfilePresetId('engineering-hiring', null)).toBe('engineering-hiring');
  });

  it('with no recorded choice (legacy) the specialization label still resolves back to its preset', () => {
    expect(selectMarketProfilePresetId(null, 'Инженерный подбор')).toBe('engineering-hiring');
    expect(selectMarketProfilePresetId(undefined, 'Финансовый софт')).toBe('finance-software');
    expect(selectMarketProfilePresetId(null, 'Промышленный подбор')).toBeNull();
    expect(selectMarketProfilePresetId(null, null)).toBeNull();
  });
});

describe('getMarketProfilePresetById', () => {
  it('returns the preset for a canonical id and null otherwise', () => {
    expect(getMarketProfilePresetById('engineering-hiring')?.label).toBe('Инженерный подбор');
    expect(getMarketProfilePresetById('Инженерный подбор')).toBeNull();
    expect(getMarketProfilePresetById('custom')).toBeNull();
    expect(getMarketProfilePresetById(null)).toBeNull();
  });
});

describe('buildMarketProfileDraftFromPreset', () => {
  it('maps demand signals to includeKeywords and copies arrays (no shared references)', () => {
    const preset = requirePreset('engineering-hiring');
    const draft = buildMarketProfileDraftFromPreset(preset);
    expect(draft.specialization).toBe('Инженерный подбор');
    expect(draft.includeKeywords).toEqual([...preset.criteria.demandSignals]);
    expect(draft.roles).toEqual([...preset.criteria.roles]);
    expect(draft.industries).toEqual([...preset.criteria.industries]);
    expect(draft.remoteFriendly).toBe(true);
    // mutation-safe copies
    draft.roles.push('sales');
    expect(preset.criteria.roles).not.toContain('sales');
  });
});
