import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const HH_EMPLOYER_CACHE_ROOT = resolve(SCRIPT_DIR, '..', '..', 'var', 'cache');
const DEFAULT_CACHE_FILE = 'hh-employer-details.json';

/** Resolve the configured cache only inside the repository-owned cache root. */
export function resolveHhEmployerDetailCachePath(value) {
  const raw = String(value ?? '').trim() || DEFAULT_CACHE_FILE;
  const candidate = resolve(HH_EMPLOYER_CACHE_ROOT, raw);
  const boundary = relative(HH_EMPLOYER_CACHE_ROOT, candidate);
  if (boundary === '..' || boundary.startsWith(`..${sep}`) || isAbsolute(boundary)) {
    throw new Error(`HH employer detail cache path must stay inside ${HH_EMPLOYER_CACHE_ROOT}.`);
  }
  return candidate;
}
