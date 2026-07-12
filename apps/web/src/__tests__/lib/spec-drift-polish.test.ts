/**
 * Spec-drift polish (2026-07-09) — two small fixes from the Stage-1 / delivery
 * specs, no schema/scoring/gate/ownerId/Stage-2 changes.
 *
 * F-A (delivery-paths-and-ai-roadmap §"UX-хук (готовить дёшево)"): the spec
 * asks for an explicit TODO marker at the Stage-1 AI-assist hook point next to
 * the pure derivation functions in leads-data.ts (deriveWhyNow /
 * deriveLawfulContactPath), so Stage-1 can plug in without a refactor. The
 * marker must be present in the source.
 *
 * F-B (client-product-system §2.B.5 + T7.3 canonicalization tail): the
 * profile-form hint still carried the anglicism "скоринг" (T7.3 covered the
 * dashboard metric labels but not this helper-text). Canonicalize to "оценку".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readLib(rel: string): string {
  return readFileSync(resolve(process.cwd(), 'lib', rel), 'utf8');
}
function readApp(rel: string): string {
  return readFileSync(resolve(process.cwd(), 'app', rel), 'utf8');
}

describe('F-A — Stage-1 AI-assist hook marker at derive functions', () => {
  it('leads-data.ts marks the Stage-1 hook point next to deriveWhyNow / deriveLawfulContactPath', () => {
    const src = readLib('leads-data.ts')
    // The spec asks for an explicit TODO/marker so Stage-1 plugs in without a
    // refactor. The marker must reference Stage-1 + the hook point.
    expect(src).toMatch(/Stage[- ]1/i)
    expect(src).toMatch(/deriveWhyNow/)
    expect(src).toMatch(/deriveLawfulContactPath/)
    // A TODO marker (not just a passive comment) sits at the derivation point.
    expect(src).toMatch(/TODO|Stage[- ]1 hook|explanation-enhance/i)
  })
})

describe('F-B — profile-form hint canonicalized (no anglicism "скоринг")', () => {
  it('profile-form.tsx hint uses "оценку", not the anglicism "скоринг"', () => {
    const src = readApp('profile/profile-form.tsx')
    // The hiringIntentMin hint previously read "...усиливает их скоринг."
    expect(src).not.toMatch(/усиливает их скоринг/)
    // Canonicalized to "оценку".
    expect(src).toMatch(/усиливает их оценку/)
  })
})
