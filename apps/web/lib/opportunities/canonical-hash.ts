import { createHash } from 'node:crypto'

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJsonStringify(value))
    .digest('hex')
}

export function canonicalizeOpportunityUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith('utm_') ||
        ['ref', 'source', 'tracking', 'from'].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.trim() || null
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return null
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
