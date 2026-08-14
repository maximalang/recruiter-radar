import { lookup as defaultDnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'instance-data.ec2.internal',
  'metadata.azure.internal',
]);

/** Canonical synchronous URL policy shared by web and DB crawler runtimes. */
export function validateCrawlerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, reason: 'malformed URL' };
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { valid: false, reason: `scheme "${url.protocol}" not allowed — only http: and https:` };
  }
  if (!url.hostname) return { valid: false, reason: 'missing hostname' };
  if (url.username || url.password) return { valid: false, reason: 'embedded URL credentials are not allowed' };

  const hostname = normalizeHostname(url.hostname);
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return { valid: false, reason: `internal hostname ${hostname} is not allowed` };
  }
  return validateAddress(hostname);
}

/** Resolve every address immediately before navigation/request and fail closed. */
export async function assertCrawlerUrlIsPublic(value, options = {}) {
  const validation = validateCrawlerUrl(value);
  if (!validation.valid) throw createSsrfError(value, validation.reason);

  const url = new URL(value);
  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname)) return { url, hostname, addresses: [hostname] };

  let resolved;
  try {
    resolved = await (options.lookup ?? defaultDnsLookup)(hostname, { all: true, verbatim: true });
  } catch (error) {
    const wrapped = createSsrfError(value, `DNS resolution failed for ${hostname}`);
    wrapped.cause = error;
    throw wrapped;
  }
  const records = Array.isArray(resolved) ? resolved : [resolved];
  if (records.length === 0) throw createSsrfError(value, `DNS returned no addresses for ${hostname}`);

  const addresses = [];
  for (const record of records) {
    const address = typeof record === 'string' ? record : record?.address;
    if (!address || !isIP(address)) {
      throw createSsrfError(value, `DNS returned an invalid address for ${hostname}`);
    }
    const addressValidation = validateAddress(address ?? '');
    if (!addressValidation.valid) {
      throw createSsrfError(value, `unsafe DNS address for ${hostname}: ${addressValidation.reason}`);
    }
    addresses.push(address);
  }

  const current = [...new Set(addresses)].sort();
  const previous = options.resolutionCache?.get(hostname);
  if (previous && previous.some((address) => !current.includes(address))) {
    throw createSsrfError(value, `DNS rebinding detected for ${hostname}`);
  }
  options.resolutionCache?.set(hostname, current);
  return { url, hostname, addresses: current };
}

function validateAddress(value) {
  const address = normalizeHostname(value);
  const family = isIP(address);
  if (family === 4) return validateIpv4(address);
  if (family === 6) return validateIpv6(address);
  return { valid: true };
}

function validateIpv4(address) {
  const octets = address.split('.').map(Number);
  const [a, b] = octets;
  if (a === 127) return blocked(`loopback IP ${address} is not allowed`);
  if (a === 10) return blocked(`private IP ${address} (10.0.0.0/8) is not allowed`);
  if (a === 172 && b >= 16 && b <= 31) return blocked(`private IP ${address} (172.16.0.0/12) is not allowed`);
  if (a === 192 && b === 168) return blocked(`private IP ${address} (192.168.0.0/16) is not allowed`);
  if (a === 169 && b === 254) return blocked(`link-local IP ${address} (169.254.0.0/16) is not allowed`);
  if (a === 0) return blocked(`unspecified IP ${address} (0.0.0.0/8) is not allowed`);
  if (a >= 224 && a <= 239) return blocked(`multicast IP ${address} is not allowed`);
  if (a >= 240) return blocked(`reserved IP ${address} is not allowed`);
  return { valid: true };
}

function validateIpv6(address) {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(lower);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return validateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  if (lower === '::1' || /^(?:0+:){7}0*1$/.test(lower)) return blocked('IPv6 loopback ::1 is not allowed');
  if (lower === '::' || /^(?:0+:){7}0+$/.test(lower)) return blocked('IPv6 unspecified address :: is not allowed');
  const first = Number.parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return blocked(`IPv6 unique-local ${address} (fc00::/7) is not allowed`);
  if ((first & 0xffc0) === 0xfe80) return blocked(`IPv6 link-local ${address} (fe80::/10) is not allowed`);
  if ((first & 0xff00) === 0xff00) return blocked(`IPv6 multicast ${address} is not allowed`);
  return { valid: true };
}

function normalizeHostname(value) {
  return String(value).replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function blocked(reason) {
  return { valid: false, reason };
}

function createSsrfError(url, reason) {
  const error = new Error(`Crawler URL blocked: ${reason}`);
  error.code = 'CRAWLER_SSRF_BLOCKED';
  error.url = url;
  return error;
}
