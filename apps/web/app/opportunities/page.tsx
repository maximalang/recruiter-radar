import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  isOpportunityEngineV1EnabledForOwner,
  isOpportunityOutcomesUiEnabledForOwner,
} from '@/lib/opportunities/config'
import { getOutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'
import {
  getOpportunityOutcomeOperationalSummary,
  listOpportunities,
  type OpportunityView,
} from '@/lib/opportunities/repository'
import type { OpportunityStatus } from '@/lib/opportunities/opportunity-scoring'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'
import {
  ContentCard,
  EmptyState,
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
} from '../ui/internal-page'
import { SiteFooter } from '../ui/site-footer'
import { OpportunityCard } from './opportunity-card'
import { OpportunityFunnel } from './opportunity-funnel'
import { buildOpportunityNavigation } from './navigation'
import styles from './opportunities-v2.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Morning Brief — Recruiter Radar',
  description: 'Приоритетные коммерческие возможности на основе подтверждённых эпизодов найма.',
}

const NAVIGATION = buildOpportunityNavigation()

export default async function OpportunitiesPage(props: {
  searchParams: Promise<{
    status?: string
    view?: string
    gate?: string
    preview?: string
    demo?: string
  }>
}) {
  const ownerId = await getAuthorizedOwnerId('opportunities:read')
  if (!isOpportunityEngineV1EnabledForOwner(ownerId)) notFound()

  if (!ownerId) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader
          title="Коммерческие возможности на сегодня"
          subtitle="Morning Brief из подтверждённых эпизодов найма."
        />
        <ContentCard variant="hero">
          <EmptyState
            title="Нужен вход в аккаунт"
            text="Войдите, чтобы увидеть только возможности вашего агентства."
            action={{ href: '/login', label: 'Войти в аккаунт' }}
          />
        </ContentCard>
      </InternalPageFrame>
    )
  }

  const params = await props.searchParams
  const outcomesUiEnabled = isOpportunityOutcomesUiEnabledForOwner(ownerId) &&
    params.preview !== '1' && params.demo !== '1'
  const trackingCycleId = outcomesUiEnabled
    ? `morning-brief:${new Date().toISOString().slice(0, 10)}`
    : null
  const funnelTo = new Date()
  const funnelFrom = new Date(funnelTo.getTime() - 30 * 24 * 60 * 60 * 1000)
  const statuses = parseStatusFilter(params.status)
  const view = outcomesUiEnabled ? parseView(params.view) : 'morning'
  let result: Awaited<ReturnType<typeof listOpportunities>> | null = null
  let operationalSummary: Awaited<
    ReturnType<typeof getOpportunityOutcomeOperationalSummary>
  > | null = null
  try {
    [result, operationalSummary] = await Promise.all([
      listOpportunities({
        ownerId,
        morningBriefOnly: view === 'morning',
        view,
        statuses,
        confidenceGate: params.gate === 'A' || params.gate === 'B' ||
          params.gate === 'C' || params.gate === 'D'
          ? params.gate
          : null,
        pageSize: 50,
      }),
      outcomesUiEnabled
        ? getOpportunityOutcomeOperationalSummary(ownerId)
        : Promise.resolve(null),
    ])
  } catch {
    result = null
  }

  if (!result) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader title="Коммерческие возможности на сегодня" />
        <ErrorState
          title="Brief временно не загрузился"
          description="Данные других аккаунтов не показываются. Обновите страницу через минуту."
          action={{ href: '/opportunities', label: 'Обновить' }}
        />
      </InternalPageFrame>
    )
  }

  const funnel = outcomesUiEnabled
    ? await getOutcomeFunnelSummary({
        ownerId,
        from: funnelFrom.toISOString(),
        to: funnelTo.toISOString(),
      }).catch(() => null)
    : null

  return (
    <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Коммерческие возможности на сегодня"
        subtitle="Morning Brief показывает, где свежий эпизод найма совпал с Agency DNA и прошёл evidence gates."
        nav={(
          <Link href="/leads" className={styles.headerLink}>
            Research mode
          </Link>
        )}
      />

      <div className={styles.pageStack}>
        <section className={styles.briefingHero} aria-labelledby="briefing-hero-title">
          <div className={styles.briefingCopy}>
            <span className={styles.briefingKicker}>Сегодня для агентства</span>
            <h2 id="briefing-hero-title" className={styles.briefingTitle}>
              Не список компаний. <span>Окна для разговора.</span>
            </h2>
            <p className={styles.briefingDescription}>
              Каждая возможность связана с реальным hiring-эпизодом, объясняет «почему сейчас», показывает силу доказательств и предлагает следующий коммерческий шаг.
            </p>
            <div className={styles.briefingSignals} aria-label="Принципы Morning Brief">
              <span className={styles.briefingSignal}>Agency-specific</span>
              <span className={styles.briefingSignal}>Evidence-linked</span>
              <span className={styles.briefingSignal}>Action-first</span>
            </div>
          </div>

          <div className={styles.radarPanel} aria-hidden="true">
            <div className={styles.radarGrid}>
              <span className={styles.radarOrbit} />
              <span className={styles.radarAxis} />
              <span className={styles.radarBeam} />
              <span className={`${styles.radarDot} ${styles.radarDotOne}`} />
              <span className={`${styles.radarDot} ${styles.radarDotTwo}`} />
              <span className={`${styles.radarDot} ${styles.radarDotThree}`} />
              <span className={styles.radarCenter}>
                <strong>{result.opportunities.length}</strong>
                <span>активных возможностей</span>
              </span>
            </div>
          </div>

          {outcomesUiEnabled ? (
            <div className={styles.metricsRail} aria-label="Состояние коммерческого потока">
              <MetricCell
                label="Новые"
                value={operationalSummary?.newCount ?? 0}
                text="свежие окна для контакта"
              />
              <MetricCell
                label="В работе"
                value={operationalSummary?.acceptedCount ?? 0}
                text="приняты агентством"
              />
              <MetricCell
                label="Pipeline"
                value={operationalSummary?.pipelineCount ?? 0}
                text="контакт, ответ, встреча"
              />
              <MetricCell
                label="Отложены"
                value={operationalSummary?.snoozedCount ?? 0}
                text="вернутся в следующий цикл"
              />
            </div>
          ) : null}
        </section>

        {funnel ? <OpportunityFunnel summary={funnel} /> : null}

        {outcomesUiEnabled ? (
          <nav className={styles.filters} aria-label="Фильтры Morning Brief">
            <div className={styles.filterHeader}>
              <span className={styles.filterEyebrow}>Рабочий поток</span>
              <h2 className={styles.filterTitle}>Состояние возможностей</h2>
              <p className={styles.filterText}>
                Research mode остаётся вторичным. Здесь — только движение коммерческих возможностей по циклу.
              </p>
            </div>
            <div className={styles.filterLinks}>
              <FilterLink href="/opportunities?view=morning" active={view === 'morning'}>
                Новые
              </FilterLink>
              <FilterLink
                href="/opportunities?view=accepted"
                active={view === 'accepted'}
              >
                В работе
              </FilterLink>
              <FilterLink
                href="/opportunities?view=pipeline"
                active={view === 'pipeline'}
              >
                Pipeline
              </FilterLink>
              <FilterLink
                href="/opportunities?view=snoozed"
                active={view === 'snoozed'}
              >
                Отложенные
              </FilterLink>
              <FilterLink
                href="/opportunities?view=completed"
                active={view === 'completed'}
              >
                Завершённые
              </FilterLink>
            </div>
          </nav>
        ) : null}

        <section className={styles.feed} aria-labelledby="opportunity-feed-title">
          <div className={styles.feedHeader}>
            <div className={styles.feedHeadingGroup}>
              <span className={styles.feedEyebrow}>Opportunity dossiers</span>
              <h2 id="opportunity-feed-title" className={styles.feedHeading}>
                Что делать дальше
              </h2>
            </div>
            <span className={styles.feedCount}>
              {result.opportunities.length} в текущем представлении
            </span>
          </div>

          {result.opportunities.length > 0 ? (
            <div className={styles.cardList}>
              {result.opportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  outcomesUiEnabled={outcomesUiEnabled}
                  trackingCycleId={trackingCycleId}
                />
              ))}
            </div>
          ) : (
            <ContentCard variant="hero">
              <EmptyState
                title="Радар пока не обнаружил достаточно подтверждённых коммерческих возможностей под ваш профиль."
                text="Мы не показываем компании только потому, что у них есть одна вакансия."
                action={{ href: '/leads', label: 'Открыть Research mode' }}
              />
            </ContentCard>
          )}
        </section>
      </div>
    </InternalPageFrame>
  )
}

function MetricCell(props: { label: string; value: number; text: string }) {
  return (
    <div className={styles.metricCell}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.text}</small>
    </div>
  )
}

function FilterLink(props: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={props.href}
      className={styles.filterLink}
      data-active={props.active ? 'true' : undefined}
      aria-current={props.active ? 'page' : undefined}
    >
      {props.children}
    </Link>
  )
}

function parseStatusFilter(value: string | undefined): OpportunityStatus[] {
  if (value === 'accepted,contacted') return ['accepted', 'contacted']
  if (value === 'snoozed') return ['snoozed']
  return []
}

function parseView(value: string | undefined): OpportunityView {
  return value === 'accepted' || value === 'pipeline' || value === 'snoozed' ||
    value === 'completed' || value === 'all'
    ? value
    : 'morning'
}
