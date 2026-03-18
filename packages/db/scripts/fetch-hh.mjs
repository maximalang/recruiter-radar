import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');
const searchText = '\u0440\u0435\u043a\u0440\u0443\u0442\u0435\u0440';

loadEnvFile(rootEnvPath);

if (typeof fetch !== 'function') {
  console.error('Built-in fetch is unavailable. Use Node.js 18+ to run this script.');
  process.exit(1);
}

const hhUserAgent = process.env.HH_USER_AGENT?.trim();

if (!hhUserAgent) {
  console.error('HH_USER_AGENT is not set. Add it to your environment or .env file, then run `npm run hh:fetch` again.');
  process.exit(1);
}

const url = new URL('https://api.hh.ru/vacancies');
url.searchParams.set('text', searchText);
url.searchParams.set('per_page', '20');
url.searchParams.set('page', '0');

try {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': hhUserAgent,
    },
  });

  if (!response.ok) {
    const details = await safeReadBody(response);
    const suffix = details ? `: ${details}` : '';
    throw new Error(`HH request failed with ${response.status} ${response.statusText}${suffix}`);
  }

  const payload = await response.json();
  const vacancies = Array.isArray(payload.items) ? payload.items.slice(0, 5) : [];

  console.log(`found count: ${payload.found ?? 0}`);
  console.log('first 5 vacancies:');

  if (vacancies.length === 0) {
    console.log('(no vacancies returned)');
  }

  for (const [index, vacancy] of vacancies.entries()) {
    console.log(`${index + 1}. id: ${vacancy.id ?? ''}`);
    console.log(`   name: ${vacancy.name ?? ''}`);
    console.log(`   employer name: ${vacancy.employer?.name ?? ''}`);
    console.log(`   published_at: ${vacancy.published_at ?? ''}`);
    console.log(`   alternate_url: ${vacancy.alternate_url ?? ''}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const causeMessage =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  console.error(`HH fetch failed: ${message}`);
  if (causeMessage) {
    console.error(`cause: ${causeMessage}`);
  }
  process.exit(1);
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const envFile = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');

  for (const rawLine of envFile.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = rawLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = rawLine.slice(0, separatorIndex).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = rawLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function safeReadBody(response) {
  try {
    const body = await response.text();
    return body.trim();
  } catch {
    return '';
  }
}
