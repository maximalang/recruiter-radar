import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ingestScriptPath = resolve(scriptDir, './ingest-hh.mjs');
const digestScriptPath = resolve(scriptDir, './report-hh-digest.mjs');

try {
  const ingestResult = await runScript(ingestScriptPath);
  const digestResult = await runScript(digestScriptPath);

  const vacanciesIngested = parseVacanciesIngested(ingestResult.stdout);
  const digestCompaniesCount = parseDigestCompaniesCount(digestResult.stdout);

  console.log(`vacancies ingested: ${vacanciesIngested}`);
  console.log(`digest companies count: ${digestCompaniesCount}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`HH pipeline failed: ${message}`);
  process.exit(1);
}

function runScript(scriptPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn(process.execPath, [scriptPath], {
      cwd: resolve(scriptDir, '../../..'),
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    child.on('error', (error) => {
      rejectPromise(error);
    });

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      const details = signal
        ? `signal ${signal}`
        : `exit code ${code ?? 'unknown'}`;
      rejectPromise(new Error(`${scriptPath} failed with ${details}`));
    });
  });
}

function parseVacanciesIngested(output) {
  const match = output.match(/upserts completed:\s*(\d+)/i);

  if (!match) {
    throw new Error('Unable to parse vacancies ingested from hh:ingest output.');
  }

  return Number(match[1]);
}

function parseDigestCompaniesCount(output) {
  let parsed;

  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Unable to parse hh:digest JSON output.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('hh:digest output is not a JSON array.');
  }

  return parsed.length;
}
