import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}
if (process.env.AGENCY_DNA_DB_TEST_ACK !== 'isolated') {
  throw new Error(
    'Refusing to write fixtures without AGENCY_DNA_DB_TEST_ACK=isolated.',
  )
}

const database = new Pool({ connectionString: process.env.DATABASE_URL })
const token = randomUUID()
const ownerIds = []

const restrictionUpsert = `
  INSERT INTO agency_account_restrictions (
    workspace_id,
    client_profile_id,
    owner_id,
    organization_id,
    restriction_type,
    created_by_user_id
  )
  VALUES ($1, $2, $3, $4, $5, $3)
  ON CONFLICT (workspace_id, client_profile_id, organization_id)
  DO UPDATE SET
    restriction_type = EXCLUDED.restriction_type,
    created_by_user_id = EXCLUDED.created_by_user_id,
    updated_at = NOW()
`

try {
  const owners = await database.query(
    `INSERT INTO users (email, full_name)
     VALUES ($1, 'Agency DNA verifier'), ($2, 'Agency DNA other tenant')
     RETURNING id::TEXT AS id`,
    [
      `agency-dna-${token}@example.invalid`,
      `agency-dna-other-${token}@example.invalid`,
    ],
  )
  ownerIds.push(...owners.rows.map((row) => String(row.id)))
  const [ownerId, otherOwnerId] = ownerIds

  const profiles = await database.query(
    `INSERT INTO client_profiles (
       agency_name,
       owner_id,
       service_types,
       target_seniorities
     )
     VALUES
       ('Agency DNA verifier', $1, ARRAY['permanent'], ARRAY['senior']),
       ('Agency DNA other tenant', $2, ARRAY['executive'], ARRAY['executive'])
     RETURNING
       id::TEXT AS id,
       owner_id::TEXT AS "ownerId",
       workspace_id::TEXT AS "workspaceId",
       agency_dna_version::INTEGER AS version,
       agency_dna_snapshot_hash AS hash`,
    [ownerId, otherOwnerId],
  )
  const profile = profiles.rows.find((row) => row.ownerId === ownerId)
  const otherProfile = profiles.rows.find((row) => row.ownerId === otherOwnerId)
  assert.ok(profile?.workspaceId)
  assert.ok(otherProfile?.workspaceId)
  assert.equal(profile.version, 1)
  assert.match(profile.hash, /^[a-f0-9]{64}$/)

  const organizations = await database.query(
    `INSERT INTO orgs (name, domain)
     VALUES
       ('Agency DNA verifier A', $1),
       ('Agency DNA verifier B', $2),
       ('Agency DNA verifier C', $3)
     RETURNING id::TEXT AS id`,
    [
      `agency-dna-a-${token}.example.invalid`,
      `agency-dna-b-${token}.example.invalid`,
      `agency-dna-c-${token}.example.invalid`,
    ],
  )
  const [organizationA, organizationB, organizationC] =
    organizations.rows.map((row) => String(row.id))

  await database.query(restrictionUpsert, [
    profile.workspaceId,
    profile.id,
    ownerId,
    organizationA,
    'existing_client',
  ])
  const inserted = await readProfile(profile.id)
  assert.equal(inserted.version, 2)
  assert.notEqual(inserted.hash, profile.hash)

  await database.query(restrictionUpsert, [
    profile.workspaceId,
    profile.id,
    ownerId,
    organizationA,
    'existing_client',
  ])
  assert.deepEqual(await readProfile(profile.id), inserted)

  await database.query(restrictionUpsert, [
    profile.workspaceId,
    profile.id,
    ownerId,
    organizationA,
    'conflict',
  ])
  const updated = await readProfile(profile.id)
  assert.equal(updated.version, 3)
  assert.notEqual(updated.hash, inserted.hash)

  await assert.rejects(
    database.query(restrictionUpsert, [
      profile.workspaceId,
      otherProfile.id,
      ownerId,
      organizationA,
      'conflict',
    ]),
    (error) => error?.code === 'P0001' || error?.code === '23503',
  )

  const firstWriter = await database.connect()
  const secondWriter = await database.connect()
  try {
    await firstWriter.query('BEGIN')
    await secondWriter.query('BEGIN')
    await firstWriter.query(restrictionUpsert, [
      profile.workspaceId,
      profile.id,
      ownerId,
      organizationB,
      'former_client',
    ])
    const waitingWrite = secondWriter.query(restrictionUpsert, [
      profile.workspaceId,
      profile.id,
      ownerId,
      organizationC,
      'do_not_contact',
    ])
    await firstWriter.query('COMMIT')
    await waitingWrite
    await secondWriter.query('COMMIT')
  } catch (error) {
    await firstWriter.query('ROLLBACK').catch(() => undefined)
    await secondWriter.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    firstWriter.release()
    secondWriter.release()
  }

  const concurrent = await readProfile(profile.id, true)
  assert.equal(concurrent.version, 5)
  assert.equal(concurrent.hash, concurrent.recomputedHash)
  assert.equal(concurrent.restrictionCount, 3)

  await database.query(
    `DELETE FROM agency_account_restrictions
     WHERE client_profile_id = $1 AND organization_id = $2`,
    [profile.id, organizationA],
  )
  const deleted = await readProfile(profile.id, true)
  assert.equal(deleted.version, 6)
  assert.notEqual(deleted.hash, concurrent.hash)
  assert.equal(deleted.hash, deleted.recomputedHash)

  await database.query('DELETE FROM client_profiles WHERE id = $1', [otherProfile.id])

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'restriction_insert_versions',
      'idempotent_replay_stable',
      'restriction_update_versions',
      'tenant_scope_rejected',
      'concurrent_writes_serialized',
      'hash_recomputes',
      'restriction_delete_versions',
      'profile_cascade_safe',
    ],
  }))
} finally {
  if (ownerIds.length > 0) {
    await database.query(
      'DELETE FROM client_profiles WHERE owner_id = ANY($1::BIGINT[])',
      [ownerIds],
    ).catch(() => undefined)
    await database.query(
      'DELETE FROM workspaces WHERE bootstrap_user_id = ANY($1::BIGINT[])',
      [ownerIds],
    ).catch(() => undefined)
    await database.query(
      'DELETE FROM users WHERE id = ANY($1::BIGINT[])',
      [ownerIds],
    ).catch(() => undefined)
  }
  await database.end()
}

async function readProfile(profileId, includeDerived = false) {
  const result = await database.query(
    `SELECT
       agency_dna_version::INTEGER AS version,
       agency_dna_snapshot_hash AS hash,
       CASE WHEN $2::BOOLEAN
         THEN hash_agency_dna_profile(client_profiles)
         ELSE NULL
       END AS "recomputedHash",
       CASE WHEN $2::BOOLEAN
         THEN (
           SELECT COUNT(*)::INTEGER
           FROM agency_account_restrictions restriction
           WHERE restriction.client_profile_id = client_profiles.id
         )
         ELSE NULL
       END AS "restrictionCount"
     FROM client_profiles
     WHERE id = $1`,
    [profileId, includeDerived],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}
