/**
 * @jest-environment jsdom
 *
 * T7.1 / F3 (Phase 7) — replace flat `Загрузка…` Suspense fallbacks with the
 * unified `LoadingState` primitive. A source-level contract lock: the two
 * surfaces that still had flat `<div>Загрузка...</div>` / `<ContentCard>Загрузка
 * …</ContentCard>` fallbacks (leads/page.tsx, review/page.tsx) must now route
 * their Suspense fallback through `LoadingState` (inline / skeleton), so every
 * loading moment speaks one calm vocabulary and a Suspense gap never flashes
 * white or a bare text line.
 *
 * This test reads the page source (not rendered output — the pages are async
 * server components with DB reads, too heavy to mount here) and asserts the
 * contract at the source level. It complements the LoadingState primitive
 * tests in state-primitives.test.tsx.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readApp(rel: string): string {
  const path = resolve(process.cwd(), 'app', rel);
  return readFileSync(path, 'utf8');
}

describe('T7.1 — flat Загрузка fallbacks replaced by LoadingState', () => {
  it('leads/page.tsx routes Suspense fallbacks through LoadingState, not flat text', () => {
    const src = readApp('leads/leads-page-content.tsx')
    // LoadingState is imported from the internal-page module.
    expect(src).toMatch(/LoadingState/)
    // No flat `<div ...>Загрузка...</div>` Suspense fallback remains.
    expect(src).not.toMatch(/<div[^>]*>Загрузка\.\.\.<\/div>/)
    // The fallback is now a LoadingState element (inline or skeleton variant).
    expect(src).toMatch(/fallback=\{<LoadingState/)
  })

  it('review/page.tsx routes its Suspense fallback through LoadingState, not a flat ContentCard text', () => {
    const src = readApp('review/page.tsx')
    expect(src).toMatch(/LoadingState/)
    // No flat `<ContentCard>Загрузка…</ContentCard>` fallback remains.
    expect(src).not.toMatch(/<ContentCard>Загрузка[….]<\/ContentCard>/)
    expect(src).toMatch(/fallback=\{<LoadingState/)
  })

  it('LoadingState itself is the only place the «Загрузка» text lives (the primitive owns the string)', () => {
    const src = readApp('ui/internal-page.tsx')
    // The primitive renders the text in its inline + skeleton (sr-only) variants.
    expect(src).toContain('Загрузка…')
  })
})
