const EXACT_SECRET_NAMES = new Set([
  'TELEGRAM_SESSION',
  'TELEGRAM_API_HASH',
  'HH_CLIENT_SECRET',
  'HH_PROXY_URL',
  'YOUTUBE_API_KEY',
  'GITHUB_TOKEN',
]);

function isSourceSecretName(name) {
  return EXACT_SECRET_NAMES.has(name)
    || /(?:^|_)PROVIDER_API_TOKEN$/.test(name)
    || /(?:^|_)ACCESS_TOKEN$/.test(name);
}

/** Remove exact and URL-encoded credential values before errors reach logs. */
export function redactSourceRuntimeSecrets(value, env = process.env) {
  let output = String(value ?? '');
  for (const [name, raw] of Object.entries(env)) {
    if (!isSourceSecretName(name) || typeof raw !== 'string' || raw.length < 4) continue;
    output = output.replaceAll(raw, '[redacted-source-secret]');
    const encoded = encodeURIComponent(raw);
    if (encoded !== raw) output = output.replaceAll(encoded, '[redacted-source-secret]');
  }
  return output;
}
