const SOURCE_COLORS: Record<string, string> = {
  'career-pages': '#1d4ed8',
  'habr-career': '#7c3aed',
  'rabota-rossii': '#047857',
  superjob: '#b45309',
  hh: 'var(--color-text-tertiary)',
}

const FALLBACK_PALETTE = [
  '#0f766e',
  '#be123c',
  '#0369a1',
  '#a16207',
  '#6d28d9',
  'var(--color-positive)',
  '#c2410c',
] as const

function stableIndex(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % FALLBACK_PALETTE.length
}

/** Stable, distinguishable source color for the admin ingest trend and legend. */
export function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? FALLBACK_PALETTE[stableIndex(source)]
}
