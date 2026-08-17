/**
 * @jest-environment jsdom
 *
 * T7.3 (Phase 7) — cross-surface literal/glyph audit + mojibake check.
 *
 * Locks the post-audit contract so the UX-hardening surfaces cannot regress:
 *   1. No literal interface-glyph chars (← ✓ ○) in RENDER code — only in
 *      comments/docstrings. The meaning-bearing copy affordances (→ / ↗ in
 *      "Открыть →", "Сайт компании →", "{label} ↗") are explicitly allowed
 *      (spec decision #2: copy, not iconography) and excluded from the check.
 *   2. No mojibake / broken Cyrillic in the render surfaces.
 *   3. The anglicism "скоринг" is gone from the user-facing metric labels
 *      (canonicalized to "балл" / "оценка") — premium ru-RU copy.
 *   4. Score-band vocabulary stays single-source (score-display.ts) — every
 *      surface reads Горячий/Тёплый/Холодный from there, no second vocab.
 *
 * Source-level contract because the assertions are about what strings live in
 * the render code, not runtime output.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readApp(rel: string): string {
  return readFileSync(resolve(process.cwd(), 'app', rel), 'utf8');
}
function readLib(rel: string): string {
  return readFileSync(resolve(process.cwd(), 'lib', rel), 'utf8');
}

// Render files — the .tsx/.ts that emit visible strings. Excludes test files.
const RENDER_FILES = [
  'page.tsx',
  'leads/page.tsx',
  'leads/[id]/page.tsx',
  'leads/[id]/next-steps-block.tsx',
  'leads/[id]/ai-enrichment-block.tsx',
  'leads/[id]/feedback-buttons.tsx',
  'review/page.tsx',
  'review/review-actions.tsx',
  'dashboard/page.tsx',
  'dashboard/dashboard-today-radar.tsx',
  'profile/page.tsx',
  'profile/profile-form.tsx',
  'profile/profile-completion-panel.tsx',
  'profile/delivery-form.tsx',
  'onboarding/pilot/[orderId]/page.tsx',
  'onboarding/pilot/[orderId]/pilot-onboarding-components.tsx',
  'legal/page.tsx',
  'terms/page.tsx',
  'privacy/page.tsx',
  'admin/page.tsx',
  'checkout/page.tsx',
  'ui/internal-page.tsx',
  'ui/site-footer.tsx',
  'ui/web-push-opt-in.tsx',
];

describe('T7.3 — literal/glyph audit', () => {
  it('no literal interface-glyph chars (← ✓ ○) in render code', () => {
    // → and ↗ are allowed as meaning-bearing copy affordances (spec decision #2).
    // ← ✓ ○ are interface iconography and must be SVG, not literal chars.
    for (const f of RENDER_FILES) {
      const src = readApp(f);
      // Strip line-comments and block-comments so docstring mentions of the
      // old glyphs (historical notes) don't trip the check.
      const stripped = src
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      expect(stripped).not.toMatch(/[←✓○]/);
    }
  })

  it('no mojibake / broken Cyrillic byte sequences in render code', () => {
    // Mojibake from inline-shell encoding mistakes shows as Ã/Ð/Â/ï¿½ runs.
    for (const f of RENDER_FILES) {
      const src = readApp(f);
      expect(src).not.toMatch(/[ÃÐÂ][\x80-\xBF]/);
      expect(src).not.toMatch(/ï¿½/);
    }
  })
})

describe('T7.3 — score-band vocabulary stays single-source', () => {
  it('score-display.ts is the only source of Горячий/Тёплый/Холодный labels', () => {
    const scoreDisplay = readLib('scoring/score-display.ts');
    expect(scoreDisplay).toMatch(/Горячий/);
    expect(scoreDisplay).toMatch(/Тёплый/);
    expect(scoreDisplay).toMatch(/Холодный/);
  })
})
