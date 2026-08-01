'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  AgencyAccountRestriction,
  AgencyDnaProfile,
  AgencyRestrictionOrganizationOption,
} from '../../lib/agencyDnaProfile'
import { FormSubmitButton } from '../ui/form-submit-button'
import { NoticeBox } from '../ui/page-primitives'
import ppStyles from '../ui/page-primitives.module.css'
import {
  saveAgencyAccountRestrictionAction,
  saveAgencyDnaProfileAction,
  type AgencyDnaActionResult,
} from './agency-dna-actions'
import styles from './agency-dna-form.module.css'

const SERVICE_OPTIONS = [
  ['permanent', 'Постоянный подбор'],
  ['executive', 'Executive search'],
  ['volume', 'Массовый найм'],
  ['project', 'Проектный подбор'],
] as const

const SENIORITY_OPTIONS = [
  ['junior', 'Junior'],
  ['middle', 'Middle'],
  ['senior', 'Senior'],
  ['lead', 'Lead'],
  ['executive', 'Руководители'],
] as const

const ENGAGEMENT_OPTIONS = [
  ['success_fee', 'Success fee'],
  ['retainer', 'Retainer'],
  ['embedded', 'Embedded / RPO'],
  ['project', 'Фиксированный проект'],
] as const

const RESTRICTION_LABELS = {
  existing_client: 'Действующий клиент',
  former_client: 'Бывший клиент',
  do_not_contact: 'Не контактировать',
  conflict: 'Конфликт интересов',
} as const

export function AgencyDnaForm(props: {
  profile: AgencyDnaProfile
  restrictions: AgencyAccountRestriction[]
  organizations: AgencyRestrictionOrganizationOption[]
  matchCount: { count: number; capped: boolean } | null
}) {
  const { profile, restrictions, organizations, matchCount } = props
  const [profileState, profileAction] = useActionState<
    AgencyDnaActionResult | null,
    FormData
  >(saveAgencyDnaProfileAction, null)
  const [restrictionState, restrictionAction] = useActionState<
    AgencyDnaActionResult | null,
    FormData
  >(saveAgencyAccountRestrictionAction, null)
  const [serviceTypes, setServiceTypes] = useState(profile.serviceTypes)
  const [seniorities, setSeniorities] = useState(profile.targetSeniorities)
  const [engagementTypes, setEngagementTypes] = useState(
    profile.preferredEngagementTypes,
  )
  const router = useRouter()

  useEffect(() => {
    if (profileState?.ok || restrictionState?.ok) router.refresh()
  }, [profileState, restrictionState, router])

  const filledSteps = useMemo(() => [
    serviceTypes.length > 0 && seniorities.length > 0,
    engagementTypes.length > 0 || profile.minimumEngagementValueMinor !== null,
    profile.caseStudies.length > 0,
    restrictions.length > 0,
  ].filter(Boolean).length, [
    engagementTypes.length,
    profile.caseStudies.length,
    profile.minimumEngagementValueMinor,
    restrictions.length,
    seniorities.length,
    serviceTypes.length,
  ])
  const breadth = serviceTypes.length === 0 || seniorities.length === 0
    ? 'broad'
    : serviceTypes.length === 1 && seniorities.length === 1
      ? 'narrow'
      : 'balanced'
  const editableCaseCount = Math.min(
    20,
    Math.max(1, profile.caseStudies.length + (profile.caseStudies.length < 20 ? 1 : 0)),
  )

  return (
    <section aria-labelledby="agency-dna-title" className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Agency DNA · версия {profile.agencyDnaVersion}</p>
          <h2 id="agency-dna-title" className={styles.title}>Какое агентство вы строите</h2>
          <p className={styles.subtitle}>
            Короткий слой поверх текущего профиля. Он объясняет, почему opportunity
            подходит именно вам, и применяет ограничения по аккаунтам.
          </p>
        </div>
        <div className={styles.progress} role="status" aria-live="polite">
          <span>{filledSteps} из 4 ориентиров заполнено</span>
          <progress value={filledSteps} max={4} aria-label="Заполнение Agency DNA" />
        </div>
      </header>

      <form action={profileAction} className={styles.form}>
        {profileState?.ok === true ? (
          <NoticeBox tone="success" title="Agency DNA сохранён" description="Новая версия применится к следующей сборке opportunities." />
        ) : null}
        {profileState?.ok === false ? (
          <NoticeBox tone="danger" title="Не удалось сохранить Agency DNA" description={profileState.error} />
        ) : null}

        <fieldset className={styles.step}>
          <legend><span>1</span> Услуги и уровень ролей</legend>
          <p>Используется для доказуемых capability matches; само по себе не добавляет баллы FIUR.</p>
          <OptionChips
            name="serviceTypes"
            options={SERVICE_OPTIONS}
            selected={serviceTypes}
            onChange={setServiceTypes}
          />
          <OptionChips
            name="targetSeniorities"
            options={SENIORITY_OPTIONS}
            selected={seniorities}
            onChange={setSeniorities}
          />
          <div className={styles.scopeNote} data-tone={breadth} role="status">
            {breadth === 'broad'
              ? 'Профиль пока широкий: выберите хотя бы одну услугу и уровень ролей.'
              : breadth === 'narrow'
                ? 'Профиль узкий: проверьте базовое превью ниже, чтобы не потерять полезные компании.'
                : 'Охват выглядит сбалансированным; точные ограничения задаются отдельно.'}
          </div>
        </fieldset>

        <fieldset className={styles.step}>
          <legend><span>2</span> Коммерческий формат и ёмкость</legend>
          <p>Помогает сформулировать подходящий угол работы. Ёмкость не скрывает лиды автоматически.</p>
          <OptionChips
            name="preferredEngagementTypes"
            options={ENGAGEMENT_OPTIONS}
            selected={engagementTypes}
            onChange={setEngagementTypes}
          />
          <div className={styles.twoCol}>
            <label className={ppStyles.field}>
              <span className={ppStyles.fieldLabel}>Минимальный чек, ₽</span>
              <input
                className={ppStyles.input}
                name="minimumEngagementValueRub"
                type="number"
                min={0}
                step={1}
                defaultValue={profile.minimumEngagementValueMinor === null
                  ? ''
                  : profile.minimumEngagementValueMinor / 100}
                placeholder="Например, 150000"
              />
            </label>
            <label className={ppStyles.field}>
              <span className={ppStyles.fieldLabel}>Текущая ёмкость</span>
              <select className={ppStyles.input} name="currentCapacity" defaultValue={profile.currentCapacity}>
                <option value="low">Низкая — берём точечно</option>
                <option value="normal">Обычная</option>
                <option value="high">Высокая — готовы расширяться</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.step}>
          <legend><span>3</span> Кейсы без персональных контактов</legend>
          <p>Необязательно. Сохраняйте только публично безопасное описание и измеримый результат.</p>
          <div className={styles.caseList}>
            {Array.from({ length: editableCaseCount }, (_, index) => (
              <CaseStudyFields
                key={index}
                index={index}
                study={profile.caseStudies[index]}
              />
            ))}
          </div>
        </fieldset>

        <div className={styles.preview}>
          <strong>Превью влияния</strong>
          <span>{describeMatchPreview(matchCount)}</span>
        </div>

        <div className={styles.submitRow}>
          <FormSubmitButton idleLabel="Сохранить Agency DNA" pendingLabel="Сохраняем…" className={ppStyles.primaryAction} />
          <span>Поля необязательны; старый профиль продолжит работать.</span>
        </div>
      </form>

      <form action={restrictionAction} className={styles.restrictions}>
        <div>
          <h3>4. Ограничения по аккаунтам</h3>
          <p>Действующие и бывшие клиенты меняют режим opportunity. «Не контактировать» и конфликт блокируют её.</p>
        </div>
        {restrictionState?.ok === true ? (
          <NoticeBox tone="success" title="Ограничения обновлены" description="Следующая сборка применит новый статус аккаунта." />
        ) : null}
        {restrictionState?.ok === false ? (
          <NoticeBox tone="danger" title="Не удалось обновить ограничения" description={restrictionState.error} />
        ) : null}
        <div className={styles.restrictionControls}>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Компания из ваших opportunities</span>
            <select className={ppStyles.input} name="organizationId" disabled={organizations.length === 0} required>
              <option value="">Выберите компанию</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}{organization.domain ? ` · ${organization.domain}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={ppStyles.field}>
            <span className={ppStyles.fieldLabel}>Статус</span>
            <select className={ppStyles.input} name="restrictionType" defaultValue="existing_client" disabled={organizations.length === 0} required>
              {Object.entries(RESTRICTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <FormSubmitButton idleLabel="Добавить" pendingLabel="Сохраняем…" className={ppStyles.secondaryAction} disabled={organizations.length === 0} />
        </div>
        {organizations.length === 0 ? (
          <p className={styles.empty}>Компании появятся здесь после первой сборки opportunities.</p>
        ) : null}
        {restrictions.length > 0 ? (
          <ul className={styles.restrictionList} aria-label="Ограничения по аккаунтам">
            {restrictions.map((restriction) => (
              <li key={restriction.id}>
                <span>
                  <strong>{restriction.organizationName}</strong>
                  {' · '}{RESTRICTION_LABELS[restriction.restrictionType]}
                </span>
                <button type="submit" name="deleteRestrictionId" value={restriction.id} formNoValidate aria-label={`Удалить ограничение для ${restriction.organizationName}`}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    </section>
  )
}

function OptionChips<T extends string>(props: {
  name: string
  options: readonly (readonly [T, string])[]
  selected: T[]
  onChange: (values: T[]) => void
}) {
  return (
    <div className={styles.chips}>
      {props.options.map(([value, label]) => (
        <label key={value}>
          <input
            type="checkbox"
            name={props.name}
            value={value}
            checked={props.selected.includes(value)}
            onChange={(event) => props.onChange(event.target.checked
              ? [...props.selected, value]
              : props.selected.filter((item) => item !== value))}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

function CaseStudyFields(props: {
  index: number
  study: AgencyDnaProfile['caseStudies'][number] | undefined
}) {
  const { index, study } = props
  return (
    <details className={styles.case} open={index === 0 && Boolean(study)}>
      <summary>{study ? `Кейс ${index + 1}` : 'Добавить кейс'}</summary>
      <div className={styles.caseFields}>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Семейства ролей</span>
          <input className={ppStyles.input} name={`caseStudy${index}RoleFamilies`} defaultValue={study?.roleFamilies.join(', ') ?? ''} placeholder="backend, data" />
        </label>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Отрасли</span>
          <input className={ppStyles.input} name={`caseStudy${index}Industries`} defaultValue={study?.industries.join(', ') ?? ''} placeholder="fintech, retail" />
        </label>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Размер компании</span>
          <select className={ppStyles.input} name={`caseStudy${index}CompanySizeBucket`} defaultValue={study?.companySizeBucket ?? ''}>
            <option value="">Не указан</option>
            <option value="startup">Стартап</option>
            <option value="small">Малая</option>
            <option value="medium">Средняя</option>
            <option value="large">Крупная</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Регион</span>
          <input className={ppStyles.input} name={`caseStudy${index}Region`} defaultValue={study?.region ?? ''} />
        </label>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Измеримый результат</span>
          <input className={ppStyles.input} name={`caseStudy${index}Result`} defaultValue={study?.measurableResult ?? ''} placeholder="Закрыли 8 ролей за 45 дней" />
        </label>
        <label className={ppStyles.field}>
          <span className={ppStyles.fieldLabel}>Публично безопасное описание</span>
          <textarea className={ppStyles.textarea} name={`caseStudy${index}Description`} rows={3} defaultValue={study?.publicSafeDescription ?? ''} />
        </label>
      </div>
    </details>
  )
}

function describeMatchPreview(
  matchCount: { count: number; capped: boolean } | null,
): string {
  if (!matchCount) {
    return 'Базовый пул сейчас недоступен; Agency DNA применится при следующей сборке.'
  }
  if (matchCount.count === 0) {
    return 'Базовый профиль сейчас не находит компаний. Сначала ослабьте основные фильтры.'
  }
  return `Базовый радар видит ≈${matchCount.count}${matchCount.capped ? '+' : ''} компаний. Agency DNA добавит объяснения и ограничения, не меняя FIUR.`
}
