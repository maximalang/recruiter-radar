/**
 * Owner-scoped save action for /settings/profile.
 *
 * Security invariant (anti-IDOR): the action must resolve the target profile
 * ONLY from the authenticated session owner — never from a form-supplied id —
 * and must save under that loaded id. We assert:
 *   - no session            → error, no write
 *   - owner has no profile   → error, no write
 *   - happy path            → loads by ownerId, saves under the loaded profile id,
 *                             ignores any forged `id` field in the form
 */

import { jest } from '@jest/globals'

const getClientProfileByOwnerId = jest.fn()
const saveClientProfile = jest.fn()
const readOwnerSession = jest.fn()

jest.mock('@/lib/clientProfiles', () => ({
  ...jest.requireActual('@/lib/clientProfiles'),
  getClientProfileByOwnerId,
  saveClientProfile,
}))

jest.mock('@/lib/session', () => ({
  readOwnerSession,
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

const OWNER_PROFILE = {
  id: '900',
  agencyName: 'Старое имя',
  telegramChatId: 'tg-123',
  targetCity: 'Москва',
  specialization: null,
  includeKeywords: [],
  excludeKeywords: [],
  industries: [],
  companySizes: [],
  dailyDigestLimit: 5,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  contactPolicy: 'corporate_only',
  roles: [],
  excludedIndustries: [],
  excludedLocations: [],
  remoteFriendly: false,
}

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v))
    else fd.set(key, value)
  }
  return fd
}

async function loadAction() {
  const mod = await import('../../../app/settings/profile/actions')
  return mod.saveSettingsProfileAction
}

describe('saveSettingsProfileAction', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('refuses without a session and never writes', async () => {
    readOwnerSession.mockResolvedValue(null)
    const save = await loadAction()

    const result = await save(null, form({ agencyName: 'X' }))

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/вход/i) })
    expect(saveClientProfile).not.toHaveBeenCalled()
  })

  it('refuses when the owner has no profile yet', async () => {
    readOwnerSession.mockResolvedValue('77')
    getClientProfileByOwnerId.mockResolvedValue(null)
    const save = await loadAction()

    const result = await save(null, form({ agencyName: 'X' }))

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/не найден|активируйте/i) })
    expect(saveClientProfile).not.toHaveBeenCalled()
  })

  it('loads by ownerId and saves under the loaded id, ignoring a forged form id', async () => {
    readOwnerSession.mockResolvedValue('77')
    getClientProfileByOwnerId.mockResolvedValue(OWNER_PROFILE)
    saveClientProfile.mockResolvedValue(OWNER_PROFILE)
    const save = await loadAction()

    const result = await save(
      null,
      form({
        id: '999999', // forged — must be ignored
        agencyName: 'Новое имя',
        roles: ['hr', 'sales', 'not-a-role'], // invalid filtered out
        contactPolicy: 'unrestricted',
        remoteFriendly: 'on',
        excludedLocations: 'Сибирь\nКрайний Север',
      }),
    )

    expect(result).toEqual({ ok: true })
    expect(getClientProfileByOwnerId).toHaveBeenCalledWith('77')
    expect(saveClientProfile).toHaveBeenCalledTimes(1)

    const saved = saveClientProfile.mock.calls[0][0] as Record<string, unknown>
    // id comes from the owner-scoped load, NOT from the form
    expect(saved.id).toBe('900')
    expect(saved.agencyName).toBe('Новое имя')
    expect(saved.roles).toEqual(['hr', 'sales'])
    expect(saved.contactPolicy).toBe('unrestricted')
    expect(saved.remoteFriendly).toBe(true)
    expect(saved.excludedLocations).toEqual(['Сибирь', 'Крайний Север'])
    // Telegram chat is preserved from the existing profile, not the form
    expect(saved.telegramChatId).toBe('tg-123')
  })

  it('surfaces a save error as a result, not a throw', async () => {
    readOwnerSession.mockResolvedValue('77')
    getClientProfileByOwnerId.mockResolvedValue(OWNER_PROFILE)
    saveClientProfile.mockRejectedValue(new Error('Telegram занят'))
    const save = await loadAction()

    const result = await save(null, form({ agencyName: 'X' }))

    expect(result).toEqual({ ok: false, error: 'Telegram занят' })
  })
})
