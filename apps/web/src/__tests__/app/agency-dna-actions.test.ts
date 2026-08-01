export {}

const getSession = jest.fn()
const getAgencyDnaProfile = jest.fn()
const saveAgencyDnaProfile = jest.fn()
const saveAgencyAccountRestriction = jest.fn()
const deleteAgencyAccountRestriction = jest.fn()

jest.mock('@/lib/auth-v2/authorization', () => ({ getSession }))
jest.mock('@/lib/agencyDnaProfile', () => ({
  getAgencyDnaProfile,
  saveAgencyDnaProfile,
  saveAgencyAccountRestriction,
  deleteAgencyAccountRestriction,
}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) value.forEach((item) => data.append(key, item))
    else data.set(key, value)
  }
  return data
}

describe('Agency DNA profile actions', () => {
  const originalCanary = process.env.AGENCY_DNA_V1_CANARY_WORKSPACE_IDS

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AGENCY_DNA_V1_CANARY_WORKSPACE_IDS = '9'
    getSession.mockResolvedValue({
      userId: '5',
      dataOwnerId: '7',
      workspaceId: '9',
    })
    getAgencyDnaProfile.mockResolvedValue({ profileId: '11' })
  })

  afterAll(() => {
    if (originalCanary === undefined) {
      delete process.env.AGENCY_DNA_V1_CANARY_WORKSPACE_IDS
    } else {
      process.env.AGENCY_DNA_V1_CANARY_WORKSPACE_IDS = originalCanary
    }
  })

  it('fails closed without workspace context', async () => {
    getSession.mockResolvedValue({ userId: '5', dataOwnerId: '7', workspaceId: null })
    const { saveAgencyDnaProfileAction } = await import('@/app/profile/agency-dna-actions')

    await expect(saveAgencyDnaProfileAction(null, form({})))
      .resolves.toEqual({ ok: false, error: expect.any(String) })
    expect(saveAgencyDnaProfile).not.toHaveBeenCalled()
  })

  it('saves the session-scoped profile and ignores forged tenant fields', async () => {
    saveAgencyDnaProfile.mockResolvedValue({ profileId: '11' })
    const { saveAgencyDnaProfileAction } = await import('@/app/profile/agency-dna-actions')

    const result = await saveAgencyDnaProfileAction(null, form({
      profileId: '999',
      ownerId: '999',
      workspaceId: '999',
      serviceTypes: ['permanent', 'executive'],
      targetSeniorities: ['senior'],
      preferredEngagementTypes: ['retainer'],
      minimumEngagementValueRub: '150000',
      currentCapacity: 'high',
      caseStudy0RoleFamilies: 'backend, data',
      caseStudy0Industries: 'it',
      caseStudy0HiringModes: ['specialist'],
      caseStudy0Result: '8 hires in 45 days',
      caseStudy0Description: 'Product engineering team.',
    }))

    expect(result).toEqual({ ok: true })
    expect(getAgencyDnaProfile).toHaveBeenCalledWith({
      ownerId: '7',
      workspaceId: '9',
    })
    expect(saveAgencyDnaProfile).toHaveBeenCalledWith(expect.objectContaining({
      profileId: '11',
      ownerId: '7',
      workspaceId: '9',
      serviceTypes: ['permanent', 'executive'],
      minimumEngagementValueMinor: 15000000,
      caseStudies: [expect.objectContaining({
        roleFamilies: ['backend', 'data'],
        hiringModes: ['specialist'],
      })],
    }))
  })

  it('does not expose database errors to the profile UI', async () => {
    saveAgencyDnaProfile.mockRejectedValue(
      new Error('duplicate key violates internal_constraint_name'),
    )
    const { saveAgencyDnaProfileAction } = await import('@/app/profile/agency-dna-actions')

    await expect(saveAgencyDnaProfileAction(null, form({}))).resolves.toEqual({
      ok: false,
      error: 'Не удалось сохранить Agency DNA.',
    })
  })

  it('rejects a forged case-study hiring mode at the form boundary', async () => {
    const { saveAgencyDnaProfileAction } = await import('@/app/profile/agency-dna-actions')

    await expect(saveAgencyDnaProfileAction(null, form({
      caseStudy0HiringModes: ['unsupported-mode'],
      caseStudy0Description: 'Public-safe case.',
    }))).resolves.toEqual({
      ok: false,
      error: 'Не удалось сохранить Agency DNA.',
    })
    expect(saveAgencyDnaProfile).not.toHaveBeenCalled()
  })

  it('writes and deletes restrictions under session actor and tenant scope', async () => {
    saveAgencyAccountRestriction.mockResolvedValue({ id: '31' })
    deleteAgencyAccountRestriction.mockResolvedValue(true)
    const { saveAgencyAccountRestrictionAction } =
      await import('@/app/profile/agency-dna-actions')

    await expect(saveAgencyAccountRestrictionAction(null, form({
      organizationId: '41',
      restrictionType: 'conflict',
    }))).resolves.toEqual({ ok: true })
    expect(saveAgencyAccountRestriction).toHaveBeenCalledWith({
      profileId: '11',
      ownerId: '7',
      workspaceId: '9',
      actorUserId: '5',
      organizationId: '41',
      restrictionType: 'conflict',
    })

    await expect(saveAgencyAccountRestrictionAction(null, form({
      intent: 'delete',
      restrictionId: '31',
    }))).resolves.toEqual({ ok: true })
    expect(deleteAgencyAccountRestriction).toHaveBeenCalledWith({
      restrictionId: '31',
      profileId: '11',
      ownerId: '7',
      workspaceId: '9',
    })
  })
})
