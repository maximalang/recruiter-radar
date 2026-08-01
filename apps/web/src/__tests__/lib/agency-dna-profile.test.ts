import {
  deleteAgencyAccountRestriction,
  getAgencyDnaProfile,
  saveAgencyAccountRestriction,
  saveAgencyDnaProfile,
} from '@/lib/agencyDnaProfile'

function dbReturning(rows: unknown[] = []) {
  return { query: jest.fn().mockResolvedValue({ rows, rowCount: rows.length }) }
}

const PROFILE_ROW = {
  profileId: '11',
  ownerId: '7',
  workspaceId: '9',
  serviceTypes: ['permanent'],
  targetSeniorities: ['senior'],
  minimumEngagementValueMinor: '15000000',
  preferredEngagementTypes: ['retainer'],
  caseStudies: [],
  currentCapacity: 'normal',
  agencyDnaVersion: '3',
  agencyDnaSnapshotHash: 'a'.repeat(64),
  updatedAt: '2026-08-01T10:00:00.000Z',
}

describe('Agency DNA profile repository', () => {
  it('loads the existing client profile through owner and workspace scope', async () => {
    const db = dbReturning([PROFILE_ROW])

    await expect(getAgencyDnaProfile({ ownerId: '7', workspaceId: '9' }, db))
      .resolves.toMatchObject({
        profileId: '11',
        agencyDnaVersion: 3,
        minimumEngagementValueMinor: 15000000,
      })

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE owner_id = \$1\s+AND workspace_id = \$2/),
      ['7', '9'],
    )
  })

  it('saves only the scoped profile and normalizes structured values', async () => {
    const db = dbReturning([PROFILE_ROW])

    await saveAgencyDnaProfile({
      profileId: '11',
      ownerId: '7',
      workspaceId: '9',
      serviceTypes: ['permanent', 'invalid', 'permanent'],
      targetSeniorities: ['senior'],
      minimumEngagementValueMinor: 15000000,
      preferredEngagementTypes: ['retainer'],
      caseStudies: [],
      currentCapacity: 'normal',
    }, db)

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHERE id = \$1\s+AND owner_id = \$2\s+AND workspace_id = \$3/,
      ),
      expect.arrayContaining(['11', '7', '9', ['permanent']]),
    )
  })

  it('upserts and deletes restrictions with profile, owner, and workspace scope', async () => {
    const upsertDb = dbReturning([{
      id: '31',
      organizationId: '41',
      organizationName: 'Acme',
      restrictionType: 'do_not_contact',
      updatedAt: '2026-08-01T10:00:00.000Z',
    }])

    await saveAgencyAccountRestriction({
      profileId: '11',
      ownerId: '7',
      workspaceId: '9',
      actorUserId: '5',
      organizationId: '41',
      restrictionType: 'do_not_contact',
    }, upsertDb)

    expect(upsertDb.query).toHaveBeenCalledWith(
      expect.stringMatching(/ON CONFLICT \(workspace_id, client_profile_id, organization_id\)/),
      ['9', '11', '7', '41', 'do_not_contact', '5'],
    )

    const deleteDb = dbReturning([{ id: '31' }])
    await expect(deleteAgencyAccountRestriction({
      restrictionId: '31',
      profileId: '11',
      ownerId: '7',
      workspaceId: '9',
    }, deleteDb)).resolves.toBe(true)
    expect(deleteDb.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHERE id = \$1\s+AND client_profile_id = \$2\s+AND owner_id = \$3\s+AND workspace_id = \$4/,
      ),
      ['31', '11', '7', '9'],
    )
  })
})
