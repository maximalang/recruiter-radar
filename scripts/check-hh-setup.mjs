#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(process.cwd(), '.env');
if (!existsSync(envPath)) {
  console.error('❌ .env file not found');
  process.exitCode = 1;
} else {
  const env = parseEnv(readFileSync(envPath, 'utf8'));
  const userAgent = text(env.HH_USER_AGENT);
  const accessToken = text(env.HH_ACCESS_TOKEN);
  const clientId = text(env.HH_CLIENT_ID);
  const clientSecret = text(env.HH_CLIENT_SECRET);

  const userAgentOk = Boolean(
    userAgent
      && /^RecruiterRadar\/\d+(?:\.\d+)* \([^()@\s]+@[^()\s]+\)$/.test(userAgent),
  );
  const clientPairComplete = Boolean(clientId && clientSecret);
  const clientPairPartial = Boolean(clientId) !== Boolean(clientSecret);
  const authMode = accessToken
    ? 'application-token'
    : clientPairComplete ? 'application-oauth-bootstrap' : null;

  console.log(userAgentOk
    ? '✅ HH_USER_AGENT identifies Recruiter Radar and a contact email'
    : '❌ HH_USER_AGENT must use: RecruiterRadar/1.0 (support@recruiter-radar.ru)');

  if (authMode === 'application-token') {
    console.log('✅ HH auth mode: pre-issued application access token');
  } else if (authMode === 'application-oauth-bootstrap') {
    console.log('✅ HH auth mode: client_credentials bootstrap');
    console.log('ℹ️  Production recommendation: issue one application token and store it as HH_ACCESS_TOKEN.');
  } else if (clientPairPartial) {
    console.log('❌ HH_CLIENT_ID and HH_CLIENT_SECRET must be configured together');
  } else {
    console.log('❌ HH authorization is missing: set HH_ACCESS_TOKEN or HH_CLIENT_ID + HH_CLIENT_SECRET');
  }

  if (accessToken && clientPairComplete) {
    console.log('ℹ️  HH_ACCESS_TOKEN takes precedence; client credentials remain available for controlled recovery.');
  }

  console.log('\nNext verification:');
  console.log('1. npm run verify:hh:oauth');
  console.log('2. npm run verify:hh:smoke');
  console.log('3. Run verify:hh:live-pipeline only against an isolated disposable DATABASE_URL.');

  if (!userAgentOk || !authMode || clientPairPartial) {
    process.exitCode = 1;
  }
}

function parseEnv(content) {
  const parsed = {};
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    parsed[match[1]] = unquote(match[2]);
  }
  return parsed;
}

function unquote(value) {
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
