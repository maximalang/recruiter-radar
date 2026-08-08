import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeOneWorkspaceCanary,
} from './run-commercial-signal-production-canary.mjs'
import {
  verifyCommercialSignalCanaryReceipt,
} from './lib/commercial-signal-canary-quality.mjs'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('runs preflight, yield, canary, enrichment, and captures a signed TOP review', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET' })
    if ((options.method ?? 'GET') === 'GET') {
      return response({ ok: true, enabled: true })
    }
    if (String(url).includes('query-plan-yield')) {
      return response({ success: true, result: { plansScanned: 4 } })
    }
    if (String(url).includes('run-commercial-signal-canary')) {
      return response({
        success: true,
        result: {
          workspaceId: '7',
          completed: true,
          failedStage: null,
          profileIds: ['17'],
          queryPlanner: [{}],
          sourceExecution: {
            requestsExecuted: 2,
            requestsBlocked: 0,
            requestsFailed: 0,
            fetchedRecords: 12,
            uniqueCompanies: 3,
          },
          touchedOrganizationIds: ['21'],
          writer: { written: 1, enrichmentQueued: 0, failed: 0 },
        },
      })
    }
    return response({ success: true, result: { completed: 1, failed: 0 } })
  }
  const loadReview = async () => ({
    opportunities: [{
      lineageId: '101',
      clientProfileId: '17',
      organizationId: '21',
      signalEpisodeId: '31',
      signalEpisodeIdentity: 'episode-31',
      signalEpisodeGeneration: 2,
      candidateStatus: 'qualified_actionable',
      commercialSignalCard: {
        status: 'qualified_actionable',
        whyNow: { text: 'Hiring accelerated.', basis: 'evidence', evidenceIds: ['41'] },
      },
      agencyDnaMatchBand: 'strong',
      agencyDnaReasonCodes: ['agency_dna.role_family_match'],
      queryPlans: [{ planSnapshotId: '51' }],
      evidence: [{ evidenceId: '41' }],
      companyEvents: [{ eventType: 'hiring_restart' }],
    }],
  })

  const receipt = await executeOneWorkspaceCanary({
    baseUrl: 'https://radar.example.test',
    apiKey: 'test-secret-never-returned',
    workspaceId: '7',
    runId: 'canary-2026-08-08-1',
    batchSize: 25,
    connectionString: 'postgres://unused',
    allowedHost: 'radar.example.test',
    fetchImpl,
    loadReview,
  })

  assert.equal(receipt.completed, true)
  assert.equal(receipt.failedStage, null)
  assert.equal(receipt.topRanked.length, 1)
  assert.equal(receipt.topRanked[0].hasExactEvidenceLineage, true)
  assert.equal(receipt.topRanked[0].hasWhyNow, true)
  assert.equal(receipt.topRanked[0].hasAgencyDnaLineage, true)
  assert.equal(JSON.stringify(receipt).includes('test-secret-never-returned'), false)
  assert.equal(verifyCommercialSignalCanaryReceipt(receipt).ok, true)
  assert.equal(calls.filter((call) => call.method === 'GET').length, 3)
  assert.equal(calls.filter((call) => call.method === 'POST').length, 3)
})

test('records a failed mutating stage and does not continue the pipeline', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET' })
    if ((options.method ?? 'GET') === 'GET') {
      return response({ ok: true, enabled: true })
    }
    return response({ success: false, error: 'failed' }, 500)
  }

  const receipt = await executeOneWorkspaceCanary({
    baseUrl: 'https://radar.example.test',
    apiKey: 'secret',
    workspaceId: '7',
    runId: 'canary-failed',
    connectionString: 'postgres://unused',
    allowedHost: 'radar.example.test',
    fetchImpl,
    loadReview: async () => {
      throw new Error('must not load review')
    },
  })

  assert.equal(receipt.completed, false)
  assert.equal(receipt.failedStage, 'query_plan_yield')
  assert.deepEqual(receipt.stages.map((stage) => stage.status), ['failed'])
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  assert.equal(verifyCommercialSignalCanaryReceipt(receipt).ok, true)
})

test('does not send the cron key when the target host is not allowlisted', async () => {
  let called = false
  await assert.rejects(() => executeOneWorkspaceCanary({
    baseUrl: 'https://attacker.example.test',
    allowedHost: 'radar.example.test',
    apiKey: 'production-secret',
    workspaceId: '7',
    runId: 'wrong-host',
    connectionString: 'postgres://unused',
    fetchImpl: async () => {
      called = true
      return response({ ok: true })
    },
  }), /allowed host/i)
  assert.equal(called, false)
})

test('performs no POST when any read-only preflight fails', async () => {
  const methods = []
  await assert.rejects(() => executeOneWorkspaceCanary({
    baseUrl: 'https://radar.example.test',
    allowedHost: 'radar.example.test',
    apiKey: 'production-secret',
    workspaceId: '7',
    runId: 'preflight-failed',
    connectionString: 'postgres://unused',
    fetchImpl: async (_url, options = {}) => {
      methods.push(options.method ?? 'GET')
      return response({ error: 'unavailable' }, 503)
    },
  }), /http_503/i)
  assert.equal(methods.includes('POST'), false)
})

test('fails closed before enrichment when the canary workspace mismatches', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET' })
    if ((options.method ?? 'GET') === 'GET') {
      return response({ ok: true, enabled: true })
    }
    if (String(url).includes('query-plan-yield')) {
      return response({ success: true, result: {} })
    }
    return response({
      success: true,
      result: {
        workspaceId: '8',
        completed: true,
        failedStage: null,
      },
    })
  }

  const receipt = await executeOneWorkspaceCanary({
    baseUrl: 'https://radar.example.test',
    allowedHost: 'radar.example.test',
    apiKey: 'secret',
    workspaceId: '7',
    runId: 'workspace-mismatch',
    connectionString: 'postgres://unused',
    fetchImpl,
  })

  assert.equal(receipt.completed, false)
  assert.equal(receipt.failedStage, 'commercial_signal_canary')
  assert.equal(calls.filter((call) => call.method === 'POST').length, 2)
  assert.equal(calls.some((call) =>
    call.method === 'POST' && call.url.includes('enrichment')), false)
})
