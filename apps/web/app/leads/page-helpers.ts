/**
 * Shared lead-list UI helpers — pure functions used by /leads and /review so
 * the two surfaces share one pluralization/count vocabulary instead of each
 * keeping a private copy.
 */

/**
 * Russian pluralization for "лид" (лид / лида / лидов).
 * Used by the /leads toolbar count and the /review "на проверке" count so the
 * noun agrees with the number on both surfaces.
 */
export function pluralizeLeads(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'лид';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'лида';
  return 'лидов';
}
