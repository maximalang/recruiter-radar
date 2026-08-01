'use server'

import { revalidatePath } from 'next/cache'

import {
  deleteAgencyAccountRestriction,
  getAgencyDnaProfile,
  saveAgencyAccountRestriction,
  saveAgencyDnaProfile,
} from '../../lib/agencyDnaProfile'
import { getSession } from '../../lib/auth-v2/authorization'
import { isAgencyDnaV1EnabledForContext } from '../../lib/opportunities/config'
import {
  AgencyDnaValidationError,
  type AgencyDnaCaseStudy,
} from '../../lib/opportunities/agency-dna'

export type AgencyDnaActionResult =
  | { ok: true }
  | { ok: false; error: string }

export async function saveAgencyDnaProfileAction(
  _previous: AgencyDnaActionResult | null,
  formData: FormData,
): Promise<AgencyDnaActionResult> {
  const scope = await getAgencyDnaWriteScope()
  if (!scope.ok) return scope.result

  const existing = await getAgencyDnaProfile({
    ownerId: scope.ownerId,
    workspaceId: scope.workspaceId,
  })
  if (!existing) {
    return { ok: false, error: 'Профиль Agency DNA не найден.' }
  }

  try {
    await saveAgencyDnaProfile({
      profileId: existing.profileId,
      ownerId: scope.ownerId,
      workspaceId: scope.workspaceId,
      serviceTypes: readMultiple(formData, 'serviceTypes'),
      targetSeniorities: readMultiple(formData, 'targetSeniorities'),
      minimumEngagementValueMinor: readMoneyMinor(
        formData,
        'minimumEngagementValueRub',
      ),
      preferredEngagementTypes: readMultiple(
        formData,
        'preferredEngagementTypes',
      ),
      caseStudies: readCaseStudies(formData),
      currentCapacity: readText(formData, 'currentCapacity') || 'normal',
    })
    revalidatePath('/profile')
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof AgencyDnaValidationError
        ? 'В кейсах нельзя сохранять личные email или телефоны.'
        : 'Не удалось сохранить Agency DNA.',
    }
  }
}

export async function saveAgencyAccountRestrictionAction(
  _previous: AgencyDnaActionResult | null,
  formData: FormData,
): Promise<AgencyDnaActionResult> {
  const scope = await getAgencyDnaWriteScope()
  if (!scope.ok) return scope.result

  const existing = await getAgencyDnaProfile({
    ownerId: scope.ownerId,
    workspaceId: scope.workspaceId,
  })
  if (!existing) {
    return { ok: false, error: 'Профиль Agency DNA не найден.' }
  }

  try {
    const deleteRestrictionId = readText(formData, 'deleteRestrictionId')
    if (readText(formData, 'intent') === 'delete' || deleteRestrictionId) {
      const deleted = await deleteAgencyAccountRestriction({
        restrictionId: deleteRestrictionId ??
          readRequiredText(formData, 'restrictionId'),
        profileId: existing.profileId,
        ownerId: scope.ownerId,
        workspaceId: scope.workspaceId,
      })
      if (!deleted) throw new Error('Ограничение уже удалено или недоступно.')
    } else {
      await saveAgencyAccountRestriction({
        profileId: existing.profileId,
        ownerId: scope.ownerId,
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
        organizationId: readRequiredText(formData, 'organizationId'),
        restrictionType: readRequiredText(formData, 'restrictionType'),
      })
    }
    revalidatePath('/profile')
    return { ok: true }
  } catch {
    return {
      ok: false,
      error: 'Не удалось сохранить ограничение.',
    }
  }
}

async function getAgencyDnaWriteScope(): Promise<
  | {
    ok: true
    actorUserId: string
    ownerId: string
    workspaceId: string
  }
  | { ok: false; result: AgencyDnaActionResult }
> {
  const session = await getSession({ permission: 'profiles:write' })
  if (!session?.workspaceId) {
    return {
      ok: false,
      result: { ok: false, error: 'Для Agency DNA нужен активный workspace.' },
    }
  }
  if (!isAgencyDnaV1EnabledForContext({
    dataOwnerId: session.dataOwnerId,
    workspaceId: session.workspaceId,
  })) {
    return {
      ok: false,
      result: { ok: false, error: 'Agency DNA пока не включён для workspace.' },
    }
  }
  return {
    ok: true,
    actorUserId: session.userId,
    ownerId: session.dataOwnerId,
    workspaceId: session.workspaceId,
  }
}

function readText(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRequiredText(formData: FormData, key: string): string {
  const value = readText(formData, key)
  if (!value) throw new Error(`Не заполнено поле ${key}.`)
  return value
}

function readMultiple(formData: FormData, key: string): string[] {
  return formData.getAll(key)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function readMoneyMinor(formData: FormData, key: string): number | null {
  const value = readText(formData, key)
  if (!value) return null
  const rubles = Number(value.replace(/\s/g, '').replace(',', '.'))
  const minor = rubles * 100
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error('Минимальный чек должен быть целым числом рублей.')
  }
  return minor
}

function readCaseStudies(formData: FormData): Partial<AgencyDnaCaseStudy>[] {
  const studies: Partial<AgencyDnaCaseStudy>[] = []
  for (let index = 0; index < 20; index += 1) {
    const prefix = `caseStudy${index}`
    const study: Partial<AgencyDnaCaseStudy> = {
      roleFamilies: readList(formData, `${prefix}RoleFamilies`),
      industries: readList(formData, `${prefix}Industries`),
      companySizeBucket: readText(formData, `${prefix}CompanySizeBucket`),
      region: readText(formData, `${prefix}Region`),
      measurableResult: readText(formData, `${prefix}Result`),
      publicSafeDescription: readText(formData, `${prefix}Description`),
    }
    if (
      study.roleFamilies?.length ||
      study.industries?.length ||
      study.companySizeBucket ||
      study.region ||
      study.measurableResult ||
      study.publicSafeDescription
    ) {
      studies.push(study)
    }
  }
  return studies
}

function readList(formData: FormData, key: string): string[] {
  const value = readText(formData, key)
  if (!value) return []
  return Array.from(new Set(
    value.split(/[,\r\n]+/).map((item) => item.trim()).filter(Boolean),
  ))
}
