import fs from 'node:fs/promises'
import path from 'node:path'

const REQUIRED_SCENARIOS = [
  'shown -> opened -> accepted -> contacted -> replied -> meeting -> meeting_completed -> proposal -> won',
  'contacted -> snoozed -> resumed -> replied',
  'meeting -> meeting_cancelled -> meeting -> meeting_completed',
  'won -> reverted -> proposal',
]

const REQUIRED_GATES = [
  'actor_attribution',
  'workspace_scope',
  'cross_tenant_denied',
  'idempotent_replay',
  'changed_payload_conflict',
  'raw_contact_privacy',
  'morning_brief_queues',
  'pipeline_queues',
  'completed_queues',
  'funnel_counters',
  'rebuild_zero_drift',
  'external_ingestion_404',
]

const PASSED_PROOFS = [
  'preflight_ok=true',
  'pre_activation_ready=true',
  'active_ready=true',
  'idempotent_replay=true',
  'changed_payload_status=409',
  'rebuildChanged=0',
  'external_status=404',
]

const args = process.argv.slice(2)
const fileIndex = args.indexOf('--file')
const evidenceFile = fileIndex >= 0 ? args[fileIndex + 1] : null
const allowed = new Set(['--file', evidenceFile])
const unknown = args.find((argument) => !allowed.has(argument))

if (!evidenceFile) fail('--file requires an evidence Markdown path')
if (unknown) fail(`unknown argument: ${unknown}`)

let evidence
try {
  evidence = await fs.readFile(path.resolve(evidenceFile), 'utf8')
} catch (error) {
  fail(`cannot read evidence file: ${error.message}`)
}

const errors = validateEvidence(evidence)
if (errors.length > 0) fail(errors.join('; '))

const status = readField(evidence, 'status')
process.stdout.write(`${JSON.stringify({
  event: 'opportunity_canary.evidence_verified',
  status,
  complete: status === 'passed',
  valid: true,
})}\n`)

function validateEvidence(source) {
  const errors = []
  if (!source.includes('<!-- opportunity-canary-evidence:v1 -->')) {
    errors.push('missing opportunity-canary-evidence:v1 marker')
  }

  const status = readField(source, 'status')
  if (!['blocked', 'passed'].includes(status)) {
    errors.push('status must be blocked or passed')
  }

  for (const scenario of REQUIRED_SCENARIOS) {
    if (!source.includes(`\`${scenario}\``)) {
      errors.push(`missing required scenario: ${scenario}`)
    }
  }
  for (const gate of REQUIRED_GATES) {
    if (!new RegExp(`^- \\[.\\] ${gate}:`, 'm').test(source)) {
      errors.push(`missing required gate: ${gate}`)
    }
  }

  if (!isPrivacySafe(source)) {
    errors.push('evidence must remain privacy-safe and contain no contacts or secrets')
  }

  if (status === 'blocked') {
    requireMeaningfulField(source, 'blocker', errors)
    requireMeaningfulField(source, 'next_action', errors)
  }

  if (status === 'passed') {
    if (/^- \[ \]/m.test(source) || /\b(?:NOT_RUN|BLOCKED|NOT_VERIFIED)\b/.test(source)) {
      errors.push('passed evidence contains incomplete checks')
    }
    const productionSha = readField(source, 'production_sha')
    if (!/^[0-9a-f]{40}$/.test(productionSha)) {
      errors.push('passed evidence requires an exact 40-character production_sha')
    }
    for (const scenario of REQUIRED_SCENARIOS) {
      if (!source.includes(`- [x] \`${scenario}\` - PASS`)) {
        errors.push(`scenario must be checked PASS: ${scenario}`)
      }
    }
    for (const gate of REQUIRED_GATES) {
      if (!source.includes(`- [x] ${gate}: PASS`)) {
        errors.push(`${gate} must be checked PASS`)
      }
    }
    for (const scope of ['owner_scope', 'workspace_scope']) {
      if (!/^sha256:[0-9a-f]{12,64}$/.test(readField(source, scope))) {
        errors.push(`passed evidence requires a redacted ${scope} hash reference`)
      }
    }
    for (const proof of PASSED_PROOFS) {
      if (!source.includes(proof)) errors.push(`missing passed proof: ${proof}`)
    }
  }

  return errors
}

function readField(source, field) {
  const matches = [...source.matchAll(new RegExp(`^${field}:\\s*(.+)$`, 'gm'))]
  return matches.length === 1 ? matches[0][1].trim() : ''
}

function requireMeaningfulField(source, field, errors) {
  const value = readField(source, field)
  if (!value || /^(?:TODO|TBD|REDACTED|NOT_RUN)$/i.test(value)) {
    errors.push(`${field} must describe the external blocker precisely`)
  }
}

function isPrivacySafe(source) {
  const containsEmail = /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(source)
  const containsPhone = /(?:^|\s)\+?(?:[0-9][ ()-]*){10,15}(?=\s|$)/m.test(source)
  const containsSecret = /(?:authorization\s*:|bearer\s+|api[_-]?key\s*:|password\s*:|secret\s*:|token\s*:)(?!\s*REDACTED)/i.test(source)
  const containsPrivatePayload = /(?:contact_reference|internal_note|reason_note|message_text|deal_value|revenue|amount)\s*:\s*(?!REDACTED|NOT_RECORDED)[^\s]/i.test(source)
  return !containsEmail && !containsPhone && !containsSecret && !containsPrivatePayload
}

function fail(message) {
  process.stderr.write(`Opportunity canary evidence is invalid: ${message}\n`)
  process.exit(2)
}
