const SOURCE_COLORS: Record<string, string> = {
  'career-pages': 'var(--color-information)',
  'habr-career': 'var(--color-information)',
  'rabota-rossii': 'var(--color-signal)',
  superjob: 'var(--color-copper)',
  hh: 'var(--color-text-tertiary)',
}

const FALLBACK_PALETTE = [
  'var(--color-information)',
  'var(--color-destructive)',
  'var(--color-information)',
  'var(--color-copper)',
  'var(--color-information)',
  'var(--color-positive)',
  'var(--color-destructive)',
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
