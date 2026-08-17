import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { isEvidenceRadarV1EnabledForContext } from '@/lib/intelligence/evidence-radar-config'
import { listEvidenceSourceGovernance } from '@/lib/intelligence/evidence-source-governance-repository'
import {
  SOURCE_ROLES,
  type SourceRole,
} from '@/lib/intelligence/source-registry'
import {
  getOpportunityAuthorizationContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityEngineV1EnabledForContext } from '@/lib/opportunities/config'
import {
  EmptyState,
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
} from '../../../ui/internal-page'
import { buildAccountNavigation } from '../../../ui/account-navigation'
import styles from './source-registry.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Диагностика источников — Recruiter Radar',
  description: 'Состояние, доступ, правовой review и качество источников.',
}

const NAVIGATION = buildAccountNavigation('settings')

const ROLE_LABELS: Record<SourceRole, string> = {
  hiring: 'Hiring',
  company_registry: 'Company Registry',
  contracts_demand: 'Contracts and Demand',
  capital_corporate: 'Capital and Corporate Events',
  product_commercial: 'Product and Commercial Activity',
  technology: 'Technology',
  people_organization: 'People and Organization',
  physical_expansion: 'Physical Expansion',
  media_social: 'Media and Social Evidence',
  risk: 'Risk Signals',
  first_party: 'First-party Signals',
}

export default async function DiagnosticsSourcesPage() {
  const authorization = await getOpportunityAuthorizationContext('opportunities:read')

  if (!authorization) {
    return (
      <InternalPageFrame navItems={NAVIGATION}>
        <InternalPageHeader title="Источники" subtitle="Управляемый реестр доказательных источников." />
        <section className={styles.noticeSurface}>
          <EmptyState
            title="Нет доступа к диагностике источников"
            text="Войдите в рабочее пространство с доступом к диагностике."
            action={{ href: '/login', label: 'Войти' }}
          />
        </section>
      </InternalPageFrame>
    )
  }

  if (!isOpportunityEngineV1EnabledForContext(authorization)) notFound()
  if (!isEvidenceRadarV1EnabledForContext(authorization)) notFound()
  const sources = await listEvidenceSourceGovernance().catch(() => null)

  if (!sources) {
    return (
      <InternalPageFrame navItems={NAVIGATION}>
        <InternalPageHeader
          title="Источники"
          subtitle="Текущие подключения и решения правового review."
        />
        <ErrorState
          title="Диагностика источников временно не загрузилась"
          description="Статический policy-файл не используется как подмена operational журнал review. Проверьте миграции и подключение к БД."
          action={{ href: '/settings/diagnostics/sources', label: 'Обновить' }}
        />
      </InternalPageFrame>
    )
  }

  const connected = sources.filter((source) => source.operational.integrationStatus === 'connected').length
  const automatable = sources.filter((source) => source.operational.automationAllowed).length
  const pending = sources.filter((source) => source.operational.reviewStatus === 'pending').length

  return (
    <InternalPageFrame navItems={NAVIGATION}>
      <InternalPageHeader
        title="Источники"
        subtitle="Техническое подключение не означает разрешение на автоматический сбор. Радар работает fail-closed."
        nav={<Link href="/opportunities/radar">Открыть Радар</Link>}
      />

      <div className={styles.stack}>
        <section className={styles.summary} aria-label="Состояние источников">
          <div><span>Источники</span><strong>{sources.length}</strong></div>
          <div><span>Роли</span><strong>{SOURCE_ROLES.length}</strong></div>
          <div><span>Подключены технически</span><strong>{connected}</strong></div>
          <div><span>Автоматизация разрешена</span><strong>{automatable}</strong></div>
        </section>

        <section className={styles.noticeSurface}>
          <p className={styles.notice}>
            На текущем контуре {pending} источников остаются без зафиксированного legal review.
            Таблица ниже читает последнюю запись журнал review из PostgreSQL, поэтому обновление статического
            TypeScript policy не может само разрешить сбор. CAPTCHA, закрытые API, private groups и персональный
            contact enrichment не используются.
          </p>
        </section>

        {SOURCE_ROLES.map((role) => {
          const roleSources = sources.filter((source) => source.role === role)
          return (
            <section key={role} className={styles.roleCard} aria-labelledby={`source-role-${role}`}>
                <div className={styles.roleHeader}>
                  <h2 id={`source-role-${role}`}>{ROLE_LABELS[role]}</h2>
                  <span>{roleSources.length} источников</span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Источник</th><th>Runtime</th><th>Доступ</th><th>Статус</th><th>Legal</th>
                        <th>Cadence</th><th>Надёжность</th><th>Match</th><th>План</th><th>Условия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roleSources.map((source) => (
                        <tr key={source.id}>
                          <td>{source.name}<small>{source.category}</small></td>
                          <td>
                            {source.runtimeSourceIds.length > 0 ? source.runtimeSourceIds.join(', ') : 'нет adapter binding'}
                            <small>{source.operational.automationAllowed ? 'automation allowed' : 'fail-closed'}</small>
                          </td>
                          <td>{source.accessMethod}<small>{source.authorization} · {source.requestLimits}</small></td>
                          <td><span className={styles.badge} data-state={source.operational.integrationStatus}>{source.operational.integrationStatus}</span></td>
                          <td>
                            <span className={styles.badge} data-review={source.operational.reviewStatus}>{source.operational.reviewStatus}</span>
                            <small>{source.operational.automationPolicy}{source.operational.reviewedAt ? ` · ${formatReviewDate(source.operational.reviewedAt)}` : ''}</small>
                          </td>
                          <td>{source.refreshCadence}<small>{source.historicalDepth}</small></td>
                          <td>{source.reliability}<small>{source.primaryEvidence ? 'primary evidence eligible' : 'supporting evidence'}</small></td>
                          <td>{source.entityMatchQuality}<small>{source.geography}</small></td>
                          <td>{source.phase} · P{source.priority}<small>{source.costClass} · {source.complexity}</small></td>
                          <td>
                            {source.operational.termsReference?.startsWith('https://') ? (
                              <a className={styles.link} href={source.operational.termsReference} target="_blank" rel="noreferrer">review reference</a>
                            ) : source.operational.termsReference ?? 'не зафиксированы'}
                            <small>{source.retentionPolicy}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            </section>
          )
        })}
      </div>
    </InternalPageFrame>
  )
}

function formatReviewDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'invalid review time'
    : new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date)
}
