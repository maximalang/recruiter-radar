import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

jest.mock('@/lib/lead-discovery/node-exec', () => ({
  getExecFile: jest.fn(),
}))

import { getExecFile } from '@/lib/lead-discovery/node-exec'
import {
  executeQueryPlannerV2Sources,
  QueryPlannerV2ExecutionScopeError,
  QueryPlannerV2SourceExecutionError,
} from '@/lib/lead-discovery/query-planner-v2-executor'

const readyEnv = {
  QUERY_PLANNER_V2_ENABLED: 'true',
  COMPANY_EVENTS_V1_ENABLED: 'true',
  COMPANY_STATE_V1_ENABLED: 'true',
  SIGNAL_EPISODES_V2_ENABLED: 'true',
  COMMERCIAL_THESIS_V1_ENABLED: 'true',
  EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true',
  AGENCY_DNA_MATCH_V2_ENABLED: 'true',
  OPPORTUNITY_SCORING_V3_ENABLED: 'true',
  COMMERCIAL_SIGNAL_RUNTIME_MODE: 'canary',
  COMMERCIAL_SIGNAL_CANARY_WORKSPACE_IDS: '9',
} as const
const execFileAsync = promisify(execFile)

describe('Query Planner v2 source executor bridge', () => {
  beforeEach(() => jest.clearAllMocks())

  it('does not spawn source execution when Query Planner is disabled', async () => {
    const result = await executeQueryPlannerV2Sources({
      workspaceId: '9',
      env: {},
    })

    expect(result.requestsExecuted).toBe(0)
    expect(getExecFile).not.toHaveBeenCalled()
  })

  it('rejects source execution outside the authoritative canary workspace', async () => {
    await expect(executeQueryPlannerV2Sources({
      workspaceId: '10',
      env: readyEnv,
    })).rejects.toBeInstanceOf(QueryPlannerV2ExecutionScopeError)
    expect(getExecFile).not.toHaveBeenCalled()
  })

  it('passes an exact tenant scope to the source executor and parses provenance stats', async () => {
    const execFile = jest.fn((file, args, options, callback) => {
      expect(file).toBe(process.execPath)
      expect(args).toEqual(expect.arrayContaining([
        expect.stringContaining('execute-query-planner-v2.mjs'),
        '--workspace-id',
        '9',
        '--client-profile-id',
        '17',
        '--limit',
        '12',
      ]))
      expect(options.env.COMMERCIAL_SIGNAL_RUNTIME_MODE).toBe('canary')
      callback(null, JSON.stringify({
        workspaceId: '9',
        clientProfileId: '17',
        dryRun: false,
        requestsScanned: 2,
        requestsExecuted: 1,
        requestsBlocked: 1,
        requestsFailed: 0,
        staleExecutionsReconciled: 1,
        fetchedRecords: 14,
        uniqueCompanies: 6,
        signalUpserts: 12,
        evidenceWrites: 10,
        executionIds: ['101'],
        blocked: [{
          sharedRequestId: '44',
          source: 'habr-career',
          reasonCode: 'SOURCE_NOT_OPERATOR_APPROVED',
        }],
        failures: [],
      }), '')
    })
    jest.mocked(getExecFile).mockReturnValue(execFile as never)

    const result = await executeQueryPlannerV2Sources({
      workspaceId: '9',
      clientProfileId: '17',
      limit: 12,
      env: readyEnv,
    })

    expect(result).toMatchObject({
      workspaceId: '9',
      clientProfileId: '17',
      requestsExecuted: 1,
      requestsBlocked: 1,
      requestsFailed: 0,
      staleExecutionsReconciled: 1,
      executionIds: ['101'],
    })
  })

  it('fails the stage when any source request failed and preserves safe stats', async () => {
    const execFile = jest.fn((_file, _args, _options, callback) => {
      const stats = {
        workspaceId: '9',
        clientProfileId: null,
        dryRun: false,
        requestsScanned: 1,
        requestsExecuted: 0,
        requestsBlocked: 0,
        requestsFailed: 1,
        fetchedRecords: 0,
        uniqueCompanies: 0,
        signalUpserts: 0,
        evidenceWrites: 0,
        executionIds: [],
        blocked: [],
        failures: [{
          sharedRequestId: '50',
          source: 'rabota-rossii',
          executionId: '90',
          reasonCode: 'SOURCE_HTTP_ERROR',
        }],
      }
      callback(Object.assign(new Error('exit 2'), { code: 2 }), JSON.stringify(stats), '')
    })
    jest.mocked(getExecFile).mockReturnValue(execFile as never)

    await expect(executeQueryPlannerV2Sources({
      workspaceId: '9',
      env: readyEnv,
    })).rejects.toMatchObject({
      name: QueryPlannerV2SourceExecutionError.name,
      stats: expect.objectContaining({ requestsFailed: 1 }),
    })
  })

  it('reconciles only tenant-scoped source executions past the stale cutoff', async () => {
    const moduleUrl = pathToFileURL(resolve(
      process.cwd(),
      '..',
      '..',
      'packages',
      'db',
      'scripts',
      'execute-query-planner-v2.mjs',
    )).href
    const script = `
      const module = await import(process.argv[2]);
      const calls = [];
      const db = { query: async (sql, params) => {
        calls.push({ sql, params });
        return { rowCount: 2 };
      } };
      const result = await module.reconcileStaleQueryPlannerSourceExecutions({
        workspaceId: '9',
        clientProfileId: '17',
        now: new Date('2026-08-08T16:00:00.000Z'),
      }, db);
      process.stdout.write(JSON.stringify({ result, calls }));
    `
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      script,
      'query-planner-recovery-test',
      moduleUrl,
    ])
    const output = JSON.parse(stdout)

    expect(output.result).toEqual({ reconciled: 2 })
    expect(output.calls).toEqual([{
      sql: expect.stringContaining("status = 'running'"),
      params: [
        '9',
        '17',
        '2026-08-08T16:00:00.000Z',
        '2026-08-08T15:40:00.000Z',
      ],
    }])
  })
})
