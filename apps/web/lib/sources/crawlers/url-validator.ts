/**
 * Crawler URL validator — SSRF protection.
 *
 * Validates that crawled URLs use safe schemes (http/https) and do not
 * target private/internal IP ranges. This is the single validation point
 * for all crawler fetches, including career-page enrichment.
 *
 * Private ranges blocked:
 *   - 10.0.0.0/8       (RFC 1918)
 *   - 172.16.0.0/12    (RFC 1918)
 *   - 192.168.0.0/16   (RFC 1918)
 *   - 127.0.0.0/8      (loopback)
 *   - 169.254.0.0/16   (link-local / AWS IMDS)
 *   - ::1              (IPv6 loopback)
 *   - fc00::/7         (IPv6 unique-local)
 *   - fe80::/10        (IPv6 link-local)
 */

export interface UrlValidationResult {
  valid: boolean
  reason?: string
}

/** Schemes permitted for crawler fetches. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/**
 * Validate a URL for safe crawler fetching.
 *
 * Checks:
 * 1. Parseable URL
 * 2. Allowed scheme (http/https only)
 * 3. Hostname present
 * 4. Hostname is not a private/reserved IP
 *
 * Does NOT perform DNS resolution (avoids TOCTOU/rebinding attacks).
 * If the hostname is a domain (not an IP literal), it passes the IP check
 * here; DNS-level blocking must be handled at the HTTP client layer
 * (e.g. by checking the resolved IP before following the connection).
 */
export function validateCrawlerUrl(url: string): UrlValidationResult {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, reason: 'malformed URL' }
  }

  // Scheme check
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { valid: false, reason: `scheme "${parsed.protocol}" not allowed — only http: and https:` }
  }

  // Hostname check
  const hostname = parsed.hostname
  if (!hostname) {
    return { valid: false, reason: 'missing hostname' }
  }

  // IP literal checks
  const ipResult = checkIpLiteral(hostname)
  if (!ipResult.allowed) {
    return { valid: false, reason: ipResult.reason! }
  }

  return { valid: true }
}

/**
 * Check if a hostname (which may be an IPv4 or IPv6 literal) is a private/reserved IP.
 * Domain names pass automatically (DNS-level check is the fetch layer's responsibility).
 */
function checkIpLiteral(hostname: string): { allowed: boolean; reason?: string } {
  // IPv4 literal
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (ipv4Match) {
    const octets = [ipv4Match[1], ipv4Match[2], ipv4Match[3], ipv4Match[4]].map(Number)
    if (octets.some(o => o > 255)) {
      return { allowed: true } // Not a valid IPv4, treat as domain
    }
    return checkIpv4(octets)
  }

  // IPv6 literal (URL parser wraps in brackets: "[::1]")
  if (hostname.includes(':')) {
    // Strip brackets that URL parser adds around IPv6 literals
    const bare = hostname.replace(/^\[|\]$/g, '')
    return checkIpv6(bare)
  }

  // Domain name — passes IP check; DNS-level blocking at fetch layer
  return { allowed: true }
}

function checkIpv4(octets: number[]): { allowed: boolean; reason?: string } {
  const [a, b, c, d] = octets

  // 127.0.0.0/8 — loopback
  if (a === 127) {
    return { allowed: false, reason: `loopback IP ${octets.join('.')} is not allowed` }
  }

  // 10.0.0.0/8 — RFC 1918
  if (a === 10) {
    return { allowed: false, reason: `private IP ${octets.join('.')} (10.0.0.0/8) is not allowed` }
  }

  // 172.16.0.0/12 — RFC 1918
  if (a === 172 && b >= 16 && b <= 31) {
    return { allowed: false, reason: `private IP ${octets.join('.')} (172.16.0.0/12) is not allowed` }
  }

  // 192.168.0.0/16 — RFC 1918
  if (a === 192 && b === 168) {
    return { allowed: false, reason: `private IP ${octets.join('.')} (192.168.0.0/16) is not allowed` }
  }

  // 169.254.0.0/16 — link-local / AWS IMDS
  if (a === 169 && b === 254) {
    return { allowed: false, reason: `link-local IP ${octets.join('.')} (169.254.0.0/16) is not allowed` }
  }

  // 0.0.0.0/8 — "this network"
  if (a === 0) {
    return { allowed: false, reason: `unspecified IP ${octets.join('.')} (0.0.0.0/8) is not allowed` }
  }

  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) {
    return { allowed: false, reason: `multicast IP ${octets.join('.')} is not allowed` }
  }

  // 240.0.0.0/4 — reserved
  if (a >= 240) {
    return { allowed: false, reason: `reserved IP ${octets.join('.')} is not allowed` }
  }

  return { allowed: true }
}

function checkIpv6(hostname: string): { allowed: boolean; reason?: string } {
  const lower = hostname.toLowerCase()

  // ::1 — loopback
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') {
    return { allowed: false, reason: 'IPv6 loopback ::1 is not allowed' }
  }

  // fc00::/7 — unique-local (fc00:: and fd00::)
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return { allowed: false, reason: `IPv6 unique-local ${hostname} (fc00::/7) is not allowed` }
  }

  // fe80::/10 — link-local
  if (lower.startsWith('fe8')) {
    return { allowed: false, reason: `IPv6 link-local ${hostname} (fe80::/10) is not allowed` }
  }

  // ff00::/8 — multicast
  if (lower.startsWith('ff')) {
    return { allowed: false, reason: `IPv6 multicast ${hostname} is not allowed` }
  }

  // :: — unspecified
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0' || lower === '0000:0000:0000:0000:0000:0000:0000:0000') {
    return { allowed: false, reason: 'IPv6 unspecified address :: is not allowed' }
  }

  return { allowed: true }
}
