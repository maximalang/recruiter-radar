import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { listEvidenceSourceGovernance } from '@/lib/intelligence/evidence-source-governance-repository'
import {
  SOURCE_ROLES,
  type SourceRole,
} from '@/lib/intelligence/source-registry'
import {
  getOpportunityAuthorizationContext,
} from '@/lib/opportunities/authorization'
import {
  isOpportunityCommercialSignalUiEnabledForContext,
  isOpportunityEngineV1EnabledForContext,
} from '@/lib/opportunities/config'
import {
  ContentCard,
  EmptyState,
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
} from '../../ui/internal-page'
import { SiteFooter } from '../../ui/site-footer'
import { buildOpportunityRadarNavigation } from '../navigation'
import styles from './source-registry.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Источники — Recruiter Radar',
  description: 'Source Registry: доступ, правовой gate, качество и статус интеграций.',
}

const NAVIGATION = buildOpportunityRadarNavigation('sources')

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

export default async function EvidenceSourceRegistryPage() {
  const authorization = await getOpportunityAuthorizationContext('opportunities:read')
  const featureContext = authorization ?? { dataOwnerId: null, workspaceId: null }
  if (!isOpportunityEngineV1EnabledForContext(featureContext)) notFound()

  if (!authorization) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader title="Источники" subtitle="Управляемый реестр доказательных источников." />
        <ContentCard variant="hero">
          <EmptyState
            title="Нет доступа к Source Registry"
            text="Войдите в рабочее пространство с доступом к возможностям."
            action={{ href: '/login', label: 'Войти' }}
          />
        </ContentCard>
      </InternalPageFrame>
    )
  }

  if (!isOpportunityCommercialSignalUiEnabledForContext(authorization)) notFound()
  const sources = await listEvidenceSourceGovernance().catch(() => null)

  if (!sources) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader
          title="Источники"
          subtitle="Source Registry и текущие legal review решения."
        />
        <ErrorState
          title="Source Registry временно не загрузился"
          description="Статический policy-файл не используется как подмена operational review ledger. Проверьте миграции и подключение к БД."
          action={{ href: '/opportunities/sources', label: 'Обновить' }}
        />
      </InternalPageFrame>
    )
  }

  const connected = sources.filter((source) => source.operational.integrationStatus === 'connected').length
  const automatable = sources.filter((source) => source.operational.automationAllowed).length
  const pending = sources.filter((source) => source.operational.reviewStatus === 'pending').length

  return (
    <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Источники"
        subtitle="Техническое подключение не означает разрешение на автоматический сбор. Evidence Radar работает fail-closed."
        nav={<Link href="/opportunities/radar">Открыть карту</Link>}
      />

      <div className={styles.stack}>
        <section className={styles.summary} aria-label="Состояние Source Registry">
          <div><span>Источники</span><strong>{sources.length}</strong></div>
          <div><span>Роли</span><strong>{SOURCE_ROLES.length}</strong></div>
          <div><span>Технически connected</span><strong>{connected}</strong></div>
          <div><span>Разрешены automation gate</span><strong>{automatable}</strong></div>
        </section>

        <ContentCard>
          <p className={styles.notice}>
            На текущем контуре {pending} источников остаются без зафиксированного legal review.
            Таблица ниже читает последнюю запись review ledger из PostgreSQL, поэтому обновление статического
            TypeScript policy не может само открыть ingest. CAPTCHA, закрытые API, private groups и персональный
            contact enrichment не используются.
          </p>
        </ContentCard>

        {SOURCE_ROLES.map((role) => {
          const roleSources = sources.filter((source) => source.role === role)
          return (
            <ContentCard key={role}>
              <section className={styles.roleCard} aria-labelledby={`source-role-${role}`}>
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
            </ContentCard>
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
