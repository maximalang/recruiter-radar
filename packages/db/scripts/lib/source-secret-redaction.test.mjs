import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSourceRuntimeSecrets } from './source-secret-redaction.mjs';

test('redacts Telegram session, HH secrets, YouTube key, and provider tokens', () => {
  const env = {
    TELEGRAM_SESSION: 'telegram-session-sensitive',
    TELEGRAM_API_HASH: 'telegram-hash-sensitive',
    HH_CLIENT_SECRET: 'hh-secret-sensitive',
    HH_PROXY_URL: 'http://user:pass@proxy.example',
    YOUTUBE_API_KEY: 'youtube-key-sensitive',
    FUNDING_SIGNALS_PROVIDER_API_TOKEN: 'provider-token-sensitive',
  };
  const observable = [
    ...Object.values(env),
    encodeURIComponent(env.YOUTUBE_API_KEY),
  ].join(' | ');

  const redacted = redactSourceRuntimeSecrets(observable, env);

  for (const secret of Object.values(env)) assert.equal(redacted.includes(secret), false);
  assert.equal(redacted.includes(encodeURIComponent(env.YOUTUBE_API_KEY)), false);
  assert.match(redacted, /\[redacted-source-secret\]/);
});

test('does not redact non-secret source configuration', () => {
  assert.equal(
    redactSourceRuntimeSecrets('source=hh area=1', { HH_AREA: '1' }),
    'source=hh area=1',
  );
});
