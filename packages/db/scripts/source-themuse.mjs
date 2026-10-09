import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadEnvFile } from './adapters/rf-source-runtime.mjs';
import { createPublicExpansionSource } from './adapters/public-source-expansion.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(scriptDir, '../../../.env'));

const source = createPublicExpansionSource('themuse');

export const resolveThemuseConfiguredInput = source.resolveConfiguredInput;
export const buildFetchSummary = source.buildFetchSummary;

export async function runThemuseCli(argv = process.argv.slice(2)) {
  await source.runCli(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runThemuseCli();
