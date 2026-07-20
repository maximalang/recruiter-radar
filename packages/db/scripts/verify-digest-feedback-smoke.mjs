import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '../../..');
const runnerPath = resolve(scriptDir, './verify-digest-feedback-smoke-runner.mts');

const result = spawnSync(
  process.execPath,
  ['--loader', 'ts-node/esm', '--experimental-specifier-resolution=node', runnerPath],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      TS_NODE_PROJECT: resolve(rootDir, 'apps/web/tsconfig.json'),
      TS_NODE_TRANSPILE_ONLY: 'true',
      TS_NODE_EXPERIMENTAL_SPECIFIER_RESOLUTION: 'node',
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        module: 'ESNext',
        moduleResolution: 'Bundler',
        allowImportingTsExtensions: true,
      }),
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`Digest feedback smoke launcher failed: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
