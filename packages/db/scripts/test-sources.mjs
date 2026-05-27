import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = (name) => resolve(__dirname, name);

console.log('🔍 Testing all available sources...\n');

const results = {};

function runFetch(scriptName, env = {}) {
  return new Promise((resolveFetch, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(__dirname, scriptName), 'fetch'],
      {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `process exited with code ${code}`));
        return;
      }

      const trimmed = stdout.trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start === -1 || end === -1) {
        reject(new Error(`no JSON object in stdout: ${trimmed.slice(0, 200)}`));
        return;
      }

      try {
        resolveFetch(JSON.parse(trimmed.slice(start, end + 1)));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function runSource(label, emoji, scriptName, env) {
  console.log(`${emoji} Testing ${label}...`);
  try {
    const summary = await runFetch(scriptName, env);
    const records = summary?.normalizedRecords ?? 0;
    results[label] = {
      success: true,
      records,
      message: `Fetched ${records} records`,
    };
    console.log(`✅ ${label}: ${records} records\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results[label] = { success: false, error: message, message };
    console.log(`❌ ${label} failed: ${message}\n`);
  }
}

await runSource('Rabota Rossii', '📋', 'source-rabota-rossii.mjs', {
  RABOTA_ROSSII_SEARCH_TEXT: 'рекрутер',
  RABOTA_ROSSII_LIMIT: '10',
});

await runSource('Career Pages', '🏢', 'source-career-pages.mjs', {
  CAREER_PAGES_TARGETS_FILE: fixturePath('career-pages-smoke-targets.json'),
});

await runSource('EGRUL', '📄', 'source-egrul-fns.mjs', {
  EGRUL_FNS_INPUT_FILE: fixturePath('egrul-fns-smoke-fixture.json'),
});

await runSource('Company Site', '🌐', 'source-company-site.mjs', {
  COMPANY_SITE_INPUT_FILE: fixturePath('company-site-smoke-fixture.json'),
});

await runSource('Funding Signals', '💼', 'source-funding-business-signals.mjs', {
  FUNDING_BUSINESS_SIGNALS_INPUT_FILE: fixturePath('funding-business-signals-smoke-fixture.json'),
});

await runSource('Habr Career', '💻', 'source-habr-career.mjs', {
  HABR_CAREER_INPUT_FILE: fixturePath('confidence-fixtures/habr-career-confidence-fixture.json'),
});

await runSource('Industry Media', '📰', 'source-industry-media.mjs', {
  INDUSTRY_MEDIA_INPUT_FILE: fixturePath('rf-context-sources-smoke-fixture.json'),
});

console.log('📊 SUMMARY:');
console.log('='.repeat(50));
const successful = Object.values(results).filter((r) => r.success).length;
const total = Object.keys(results).length;
console.log(`✅ Successful: ${successful}/${total}`);
console.log(`❌ Failed: ${total - successful}/${total}`);

console.log('\n📝 RESULTS:');
for (const [name, result] of Object.entries(results)) {
  const status = result.success ? '✅' : '❌';
  console.log(`${status} ${name}: ${result.message}`);
}

writeFileSync(
  resolve(__dirname, 'test-sources-results.json'),
  JSON.stringify(results, null, 2),
);

console.log('\n📄 Results saved to packages/db/scripts/test-sources-results.json');

if (successful < total) {
  process.exitCode = 1;
}
