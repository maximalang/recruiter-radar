import { runSourceActionCli } from './run-source-action.mjs';

await runSourceActionCli(['pipeline', process.argv[2]?.trim() || 'hh']);
