/**
 * Regression guard for the hiringIntentMin read/write boundary.
 *
 * `hiringIntentMin` is stored on the internal FIUR [0,4] signal-strength scale
 * (the contract `digest.ts` filters on: `toSignalStrength(total_score) <
 * hiringIntentMin`). The PROFILE FORM, however, submits on the user-facing
 * 0–100 points scale (the number the lead card shows), so the two normalizers
 * have different jobs:
 *
 *   - `formPointsToHiringIntentMin` (WRITE path / `saveClientProfile`):
 *       form points (0–100) → stored strength (0–4) via ÷25.
 *   - `normalizeHiringIntentMin` (READ path / `mapClientProfileRow`):
 *       idempotent clamp of an ALREADY-[0,4] stored value; MUST NOT divide.
 *
 * The bug this guards against: a single ÷25 normalizer used on BOTH paths
 * re-divided the stored strength on every read, shrinking the threshold 25×
 * (a saved 3.0 → read back as 0.12) and silently disabling the floor after the
 * first save — with no test failing because no test exercised the round trip.
 */
import {
  normalizeHiringIntentMin,
  formPointsToHiringIntentMin,
} from '@/lib/clientProfiles'

describe('hiringIntentMin write path — formPointsToHiringIntentMin', () => {
  it('converts the form 0–100 points to the stored [0,4] strength via ÷25', () => {
    // 75 points = the "горячий" 3.0-of-4 cut = the lead-card hot floor.
    expect(formPointsToHiringIntentMin(75)).toBe(3)
    expect(formPointsToHiringIntentMin(100)).toBe(4)
    expect(formPointsToHiringIntentMin(50)).toBe(2)
    expect(formPointsToHiringIntentMin(25)).toBe(1)
  })

  it('clamps a form value above 100 to the FIUR ceiling of 4', () => {
    expect(formPointsToHiringIntentMin(250)).toBe(4)
    expect(formPointsToHiringIntentMin(999)).toBe(4)
  })

  it('turns a non-positive / non-finite / non-number form input into null (no floor)', () => {
    expect(formPointsToHiringIntentMin(0)).toBeNull()
    expect(formPointsToHiringIntentMin(-10)).toBeNull()
    expect(formPointsToHiringIntentMin(Number.NaN)).toBeNull()
    expect(formPointsToHiringIntentMin(null)).toBeNull()
    expect(formPointsToHiringIntentMin(undefined)).toBeNull()
    expect(formPointsToHiringIntentMin('75')).toBeNull()
  })
})

describe('hiringIntentMin read path — normalizeHiringIntentMin (idempotent)', () => {
  it('passes an already-stored [0,4] strength through WITHOUT dividing', () => {
    // This is the regression line: a stored 3.0 must read back as 3.0, NOT 0.12.
    expect(normalizeHiringIntentMin(3.0)).toBe(3.0)
    expect(normalizeHiringIntentMin(2.5)).toBe(2.5)
    expect(normalizeHiringIntentMin(1.0)).toBe(1.0)
    expect(normalizeHiringIntentMin(4)).toBe(4)
  })

  it('clamps a stored value above 4 to the FIUR ceiling', () => {
    expect(normalizeHiringIntentMin(7)).toBe(4)
    expect(normalizeHiringIntentMin(4.5)).toBe(4)
  })

  it('turns a non-positive / non-finite / non-number stored value into null', () => {
    expect(normalizeHiringIntentMin(0)).toBeNull()
    expect(normalizeHiringIntentMin(-1)).toBeNull()
    expect(normalizeHiringIntentMin(Number.NaN)).toBeNull()
    expect(normalizeHiringIntentMin(null)).toBeNull()
    expect(normalizeHiringIntentMin(undefined)).toBeNull()
    expect(normalizeHiringIntentMin('3')).toBeNull()
  })
})

describe('hiringIntentMin round trip — form → store → read (no double divide)', () => {
  it('a 75-point form floor survives a save + read at strength 3.0', () => {
    // WRITE: the form submits 75 points; the store holds strength 3.0.
    const stored = formPointsToHiringIntentMin(75)
    expect(stored).toBe(3)
    // READ: the stored 3.0 reads back as 3.0 — NOT re-divided to 0.12.
    const readBack = normalizeHiringIntentMin(stored)
    expect(readBack).toBe(3)
    // And the read-back value still gates correctly vs a 3.0-of-4 candidate.
    expect(readBack).not.toBeLessThan(0.5)
  })

  it('a 50-point form floor survives a save + read at strength 2.0', () => {
    const stored = formPointsToHiringIntentMin(50)
    const readBack = normalizeHiringIntentMin(stored)
    expect(stored).toBe(2)
    expect(readBack).toBe(2)
  })
})
