import { Pool, type PoolClient } from 'pg'

import { getPool as getSharedPool } from './db-pool'
import {
  AGENCY_DNA_CAPACITIES,
  AGENCY_DNA_ENGAGEMENT_TYPES,
  AGENCY_DNA_RESTRICTION_TYPES,
  AGENCY_DNA_SERVICE_TYPES,
  AGENCY_DNA_TARGET_SENIORITIES,
  normalizeAgencyDnaCaseStudies,
  type AgencyDnaCapacity,
  type AgencyDnaCaseStudy,
  type AgencyDnaRestrictionType,
  type AgencyDnaServiceType,
} from './opportunities/agency-dna'

type AgencyDnaDbClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export type AgencyDnaProfile = {
  profileId: string
  ownerId: string
  workspaceId: string
  serviceTypes: AgencyDnaServiceType[]
  targetSeniorities: string[]
  minimumEngagementValueMinor: number | null
  preferredEngagementTypes: string[]
  caseStudies: AgencyDnaCaseStudy[]
  currentCapacity: AgencyDnaCapacity
  agencyDnaVersion: number
  agencyDnaSnapshotHash: string
  updatedAt: string
}

export type AgencyAccountRestriction = {
  id: string
  organizationId: string
  organizationName: string
  restrictionType: AgencyDnaRestrictionType
  updatedAt: string
}

export type AgencyRestrictionOrganizationOption = {
  id: string
  name: string
  domain: string | null
}

type AgencyDnaProfileRow = Omit<
  AgencyDnaProfile,
  'minimumEngagementValueMinor' | 'agencyDnaVersion'
> & {
  minimumEngagementValueMinor: string | number | null
  agencyDnaVersion: string | number
}

function getDb(db?: AgencyDnaDbClient): AgencyDnaDbClient {
  const resolved = db ?? getSharedPool()
  if (!resolved) throw new Error('DATABASE_URL is not set.')
  return resolved
}

export async function getAgencyDnaProfile(
  scope: { ownerId: string | number; workspaceId: string | number },
  db?: AgencyDnaDbClient,
): Promise<AgencyDnaProfile | null> {
  const ownerId = normalizeId(scope.ownerId, 'owner')
  const workspaceId = normalizeId(scope.workspaceId, 'workspace')
  const result = await getDb(db).query<AgencyDnaProfileRow>(`
    SELECT
      id::TEXT AS "profileId",
      owner_id::TEXT AS "ownerId",
      workspace_id::TEXT AS "workspaceId",
      service_types AS "serviceTypes",
      target_seniorities AS "targetSeniorities",
      minimum_engagement_value_minor::TEXT AS "minimumEngagementValueMinor",
      preferred_engagement_types AS "preferredEngagementTypes",
      case_studies AS "caseStudies",
      current_capacity AS "currentCapacity",
      agency_dna_version::TEXT AS "agencyDnaVersion",
      agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
      updated_at::TEXT AS "updatedAt"
    FROM client_profiles
    WHERE owner_id = $1
      AND workspace_id = $2
    LIMIT 1
  `, [ownerId, workspaceId])
  return result.rowCount === 1 ? mapAgencyDnaProfile(result.rows[0]) : null
}

export async function saveAgencyDnaProfile(input: {
  profileId: string | number
  ownerId: string | number
  workspaceId: string | number
  serviceTypes: readonly string[]
  targetSeniorities: readonly string[]
  minimumEngagementValueMinor: number | null
  preferredEngagementTypes: readonly string[]
  caseStudies: readonly Partial<AgencyDnaCaseStudy>[]
  currentCapacity: string
}, db?: AgencyDnaDbClient): Promise<AgencyDnaProfile> {
  const profileId = normalizeId(input.profileId, 'profile')
  const ownerId = normalizeId(input.ownerId, 'owner')
  const workspaceId = normalizeId(input.workspaceId, 'workspace')
  const serviceTypes = filterAllowed(input.serviceTypes, AGENCY_DNA_SERVICE_TYPES)
  const targetSeniorities = filterAllowed(
    input.targetSeniorities,
    AGENCY_DNA_TARGET_SENIORITIES,
  )
  const preferredEngagementTypes = filterAllowed(
    input.preferredEngagementTypes,
    AGENCY_DNA_ENGAGEMENT_TYPES,
  )
  const currentCapacity = AGENCY_DNA_CAPACITIES.includes(
    input.currentCapacity as AgencyDnaCapacity,
  ) ? input.currentCapacity as AgencyDnaCapacity : 'normal'
  const minimumEngagementValueMinor = normalizeMoneyMinor(
    input.minimumEngagementValueMinor,
  )
  const caseStudies = normalizeAgencyDnaCaseStudies(input.caseStudies)

  const result = await getDb(db).query<AgencyDnaProfileRow>(`
    UPDATE client_profiles
    SET
      service_types = $4,
      target_seniorities = $5,
      minimum_engagement_value_minor = $6,
      preferred_engagement_types = $7,
      case_studies = $8::JSONB,
      current_capacity = $9
    WHERE id = $1
      AND owner_id = $2
      AND workspace_id = $3
    RETURNING
      id::TEXT AS "profileId",
      owner_id::TEXT AS "ownerId",
      workspace_id::TEXT AS "workspaceId",
      service_types AS "serviceTypes",
      target_seniorities AS "targetSeniorities",
      minimum_engagement_value_minor::TEXT AS "minimumEngagementValueMinor",
      preferred_engagement_types AS "preferredEngagementTypes",
      case_studies AS "caseStudies",
      current_capacity AS "currentCapacity",
      agency_dna_version::TEXT AS "agencyDnaVersion",
      agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
      updated_at::TEXT AS "updatedAt"
  `, [
    profileId,
    ownerId,
    workspaceId,
    serviceTypes,
    targetSeniorities,
    minimumEngagementValueMinor,
    preferredEngagementTypes,
    JSON.stringify(caseStudies),
    currentCapacity,
  ])
  if (result.rowCount !== 1) throw new Error('Agency DNA profile not found.')
  return mapAgencyDnaProfile(result.rows[0])
}

export async function listAgencyAccountRestrictions(
  scope: {
    profileId: string | number
    ownerId: string | number
    workspaceId: string | number
  },
  db?: AgencyDnaDbClient,
): Promise<AgencyAccountRestriction[]> {
  const params = normalizeProfileScope(scope)
  const result = await getDb(db).query<AgencyAccountRestriction>(`
    SELECT
      restriction.id::TEXT AS id,
      restriction.organization_id::TEXT AS "organizationId",
      org.name AS "organizationName",
      restriction.restriction_type AS "restrictionType",
      restriction.updated_at::TEXT AS "updatedAt"
    FROM agency_account_restrictions restriction
    JOIN orgs org ON org.id = restriction.organization_id
    WHERE restriction.client_profile_id = $1
      AND restriction.owner_id = $2
      AND restriction.workspace_id = $3
    ORDER BY org.name, restriction.id
  `, params)
  return result.rows
}

export async function listAgencyRestrictionOrganizationOptions(
  scope: {
    profileId: string | number
    ownerId: string | number
    workspaceId: string | number
  },
  db?: AgencyDnaDbClient,
): Promise<AgencyRestrictionOrganizationOption[]> {
  const params = normalizeProfileScope(scope)
  const result = await getDb(db).query<AgencyRestrictionOrganizationOption>(`
    SELECT DISTINCT
      org.id::TEXT AS id,
      org.name,
      org.domain
    FROM opportunities opportunity
    JOIN orgs org ON org.id = opportunity.organization_id
    WHERE opportunity.client_profile_id = $1
      AND opportunity.owner_id = $2
      AND opportunity.workspace_id = $3
    ORDER BY org.name, org.id
    LIMIT 200
  `, params)
  return result.rows
}

export async function saveAgencyAccountRestriction(input: {
  profileId: string | number
  ownerId: string | number
  workspaceId: string | number
  actorUserId: string | number
  organizationId: string | number
  restrictionType: string
}, db?: AgencyDnaDbClient): Promise<AgencyAccountRestriction> {
  const [profileId, ownerId, workspaceId] = normalizeProfileScope(input)
  const actorUserId = normalizeId(input.actorUserId, 'actor user')
  const organizationId = normalizeId(input.organizationId, 'organization')
  const restrictionType = normalizeRestrictionType(input.restrictionType)
  const result = await getDb(db).query<AgencyAccountRestriction>(`
    WITH upserted AS (
      INSERT INTO agency_account_restrictions (
        workspace_id,
        client_profile_id,
        owner_id,
        organization_id,
        restriction_type,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (workspace_id, client_profile_id, organization_id)
      DO UPDATE SET
        restriction_type = EXCLUDED.restriction_type,
        created_by_user_id = EXCLUDED.created_by_user_id,
        updated_at = NOW()
      RETURNING id, organization_id, restriction_type, updated_at
    )
    SELECT
      upserted.id::TEXT AS id,
      upserted.organization_id::TEXT AS "organizationId",
      org.name AS "organizationName",
      upserted.restriction_type AS "restrictionType",
      upserted.updated_at::TEXT AS "updatedAt"
    FROM upserted
    JOIN orgs org ON org.id = upserted.organization_id
  `, [
    workspaceId,
    profileId,
    ownerId,
    organizationId,
    restrictionType,
    actorUserId,
  ])
  if (result.rowCount !== 1) throw new Error('Failed to save account restriction.')
  return result.rows[0]
}

export async function deleteAgencyAccountRestriction(input: {
  restrictionId: string | number
  profileId: string | number
  ownerId: string | number
  workspaceId: string | number
}, db?: AgencyDnaDbClient): Promise<boolean> {
  const restrictionId = normalizeId(input.restrictionId, 'restriction')
  const [profileId, ownerId, workspaceId] = normalizeProfileScope(input)
  const result = await getDb(db).query<{ id: string }>(`
    DELETE FROM agency_account_restrictions
    WHERE id = $1
      AND client_profile_id = $2
      AND owner_id = $3
      AND workspace_id = $4
    RETURNING id::TEXT AS id
  `, [restrictionId, profileId, ownerId, workspaceId])
  return result.rowCount === 1
}

function mapAgencyDnaProfile(row: AgencyDnaProfileRow): AgencyDnaProfile {
  const minimum = row.minimumEngagementValueMinor === null
    ? null
    : Number(row.minimumEngagementValueMinor)
  return {
    ...row,
    minimumEngagementValueMinor: Number.isSafeInteger(minimum) ? minimum : null,
    agencyDnaVersion: Number(row.agencyDnaVersion),
    caseStudies: normalizeAgencyDnaCaseStudies(row.caseStudies),
  }
}

function normalizeProfileScope(scope: {
  profileId: string | number
  ownerId: string | number
  workspaceId: string | number
}): [string, string, string] {
  return [
    normalizeId(scope.profileId, 'profile'),
    normalizeId(scope.ownerId, 'owner'),
    normalizeId(scope.workspaceId, 'workspace'),
  ]
}

function normalizeId(value: string | number, label: string): string {
  const normalized = String(value)
  if (!/^[1-9]\d*$/.test(normalized)) throw new Error(`Invalid ${label} id.`)
  return normalized
}

function filterAllowed<T extends string>(
  input: readonly string[],
  allowed: readonly T[],
): T[] {
  const allowedSet = new Set<string>(allowed)
  return Array.from(new Set(input.map((item) => item.trim().toLowerCase())))
    .filter((item): item is T => allowedSet.has(item))
}

function normalizeRestrictionType(value: string): AgencyDnaRestrictionType {
  if (!AGENCY_DNA_RESTRICTION_TYPES.includes(value as AgencyDnaRestrictionType)) {
    throw new Error('Invalid account restriction type.')
  }
  return value as AgencyDnaRestrictionType
}

function normalizeMoneyMinor(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Minimum engagement value must be a non-negative integer.')
  }
  return value
}
