'use strict'

function resolveOpportunityCanaryFlags(ownerId, env = process.env) {
  const canaryOwner = isOpportunityCanaryOwner(ownerId, env)
  const engine =
    env.OPPORTUNITY_ENGINE_V1_ENABLED === 'true' || canaryOwner
  const outcomes = engine && (
    env.OPPORTUNITY_OUTCOMES_ENABLED === 'true' || canaryOwner
  )
  const ui = outcomes && (
    env.OPPORTUNITY_OUTCOMES_UI_ENABLED === 'true' || canaryOwner
  )

  return { engine, outcomes, ui }
}

function isOpportunityCanaryActivationReady(
  ownerId,
  phase,
  env = process.env,
) {
  if (!/^[1-9]\d*$/.test(ownerId)) return false

  const globalFlagsDisabled = (
    env.OPPORTUNITY_ENGINE_V1_ENABLED !== 'true' &&
    env.OPPORTUNITY_OUTCOMES_ENABLED !== 'true' &&
    env.OPPORTUNITY_OUTCOMES_UI_ENABLED !== 'true' &&
    env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED !== 'true'
  )
  if (!globalFlagsDisabled) return false

  const entries = getOpportunityCanaryOwnerEntries(env)
  if (phase === 'pre_activation') return entries.length === 0
  if (phase !== 'active') return false

  const entriesAreValid = entries.every((entry) => /^[1-9]\d*$/.test(entry))
  const entriesAreUnique = new Set(entries).size === entries.length
  if (
    !entriesAreValid ||
    !entriesAreUnique ||
    entries.length !== 1 ||
    entries[0] !== ownerId
  ) {
    return false
  }

  const flags = resolveOpportunityCanaryFlags(ownerId, env)
  return flags.engine && flags.outcomes && flags.ui
}

function isOpportunityCanaryOwner(ownerId, env) {
  if (!/^[1-9]\d*$/.test(ownerId)) return false

  const entries = getOpportunityCanaryOwnerEntries(env)
  return entries.length === 1 &&
    /^[1-9]\d*$/.test(entries[0]) &&
    entries[0] === ownerId
}

function getOpportunityCanaryOwnerEntries(env) {
  const rawCanaryOwnerIds = env.OPPORTUNITY_CANARY_OWNER_IDS ?? ''
  if (rawCanaryOwnerIds.trim() === '') return []

  return rawCanaryOwnerIds
    .split(',')
    .map((candidate) => candidate.trim())
}

module.exports = {
  isOpportunityCanaryActivationReady,
  resolveOpportunityCanaryFlags,
}
