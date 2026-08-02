'use strict'

function resolveOpportunityCanaryFlags(
  ownerId,
  env = process.env,
  workspaceId = null,
) {
  const canaryOwner = isOpportunityCanaryOwner(ownerId, env)
  const canaryWorkspace = isOpportunityCanaryWorkspace(workspaceId, env)
  const canary = canaryOwner || canaryWorkspace
  const engine =
    env.OPPORTUNITY_ENGINE_V1_ENABLED === 'true' || canary
  const outcomes = engine && (
    env.OPPORTUNITY_OUTCOMES_ENABLED === 'true' || canary
  )
  const ui = outcomes && (
    env.OPPORTUNITY_OUTCOMES_UI_ENABLED === 'true' || canary
  )

  return { engine, outcomes, ui }
}

function isOpportunityCanaryActivationReady(
  ownerId,
  phase,
  env = process.env,
  workspaceId = null,
) {
  if (!/^[1-9]\d*$/.test(ownerId)) return false

  const globalFlagsDisabled = (
    env.OPPORTUNITY_ENGINE_V1_ENABLED !== 'true' &&
    env.OPPORTUNITY_OUTCOMES_ENABLED !== 'true' &&
    env.OPPORTUNITY_OUTCOMES_UI_ENABLED !== 'true' &&
    env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED !== 'true' &&
    env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED !== 'true'
  )
  if (!globalFlagsDisabled) return false

  const entries = getOpportunityCanaryOwnerEntries(env)
  const workspaceEntries = getOpportunityCanaryWorkspaceEntries(env)
  if (entries.length > 0 && workspaceEntries.length > 0) return false
  if (phase === 'pre_activation') {
    return entries.length === 0 && workspaceEntries.length === 0
  }
  if (phase !== 'active') return false

  const entriesAreValid = entries.every((entry) => /^[1-9]\d*$/.test(entry))
  const entriesAreUnique = new Set(entries).size === entries.length
  if (
    (
      entries.length !== 1 ||
      !entriesAreValid ||
      !entriesAreUnique ||
      entries[0] !== ownerId
    ) && (
      workspaceEntries.length !== 1 ||
      !workspaceEntries.every((entry) => /^[1-9]\d*$/.test(entry)) ||
      new Set(workspaceEntries).size !== workspaceEntries.length ||
      workspaceId === null ||
      workspaceEntries[0] !== String(workspaceId)
    )
  ) {
    return false
  }

  const flags = resolveOpportunityCanaryFlags(ownerId, env, workspaceId)
  return flags.engine && flags.outcomes && flags.ui
}

function isOpportunityCanaryOwner(ownerId, env) {
  if (!/^[1-9]\d*$/.test(ownerId)) return false

  const entries = getOpportunityCanaryOwnerEntries(env)
  return entries.length === 1 &&
    /^[1-9]\d*$/.test(entries[0]) &&
    entries[0] === ownerId
}

function isOpportunityCanaryWorkspace(workspaceId, env) {
  if (!/^[1-9]\d*$/.test(String(workspaceId ?? ''))) return false
  const entries = getOpportunityCanaryWorkspaceEntries(env)
  return entries.length === 1 &&
    /^[1-9]\d*$/.test(entries[0]) &&
    entries[0] === String(workspaceId)
}

function getOpportunityCanaryOwnerEntries(env) {
  const rawCanaryOwnerIds = env.OPPORTUNITY_CANARY_OWNER_IDS ?? ''
  if (rawCanaryOwnerIds.trim() === '') return []

  return rawCanaryOwnerIds
    .split(',')
    .map((candidate) => candidate.trim())
}

function getOpportunityCanaryWorkspaceEntries(env) {
  const rawCanaryWorkspaceIds = env.OPPORTUNITY_CANARY_WORKSPACE_IDS ?? ''
  if (rawCanaryWorkspaceIds.trim() === '') return []

  return rawCanaryWorkspaceIds
    .split(',')
    .map((candidate) => candidate.trim())
}

module.exports = {
  isOpportunityCanaryActivationReady,
  resolveOpportunityCanaryFlags,
}
