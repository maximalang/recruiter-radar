import type {
  CommercialSignalCard,
  CommercialSignalCardConclusion,
  CommercialSignalCardMetric,
  CommercialSignalCardStatus,
} from '@/lib/opportunities/commercial-signal-card'
import styles from './opportunities.module.css'

const STATUS_LABELS: Record<CommercialSignalCardStatus, string> = {
  qualified_actionable: 'Можно действовать',
  qualified_needs_enrichment: 'Нужно обогащение',
  review: 'Нужна проверка',
  blocked: 'Заблокировано',
  expired: 'Истекло',
  dismissed: 'Отклонено',
}

export function OpportunityCommercialSignalCard(props: {
  opportunityId: string
  card: CommercialSignalCard
}) {
  return (
    <div className={styles.commercialSignalBrief}>
      <div className={styles.commercialSignalHeading}>
        <div>
          <span>Commercial Signal v3</span>
          <strong>{STATUS_LABELS[props.card.status]}</strong>
        </div>
        <small>{props.card.status.replaceAll('_', ' ')}</small>
      </div>

      <div className={`${styles.decisionGrid} ${styles.commercialSignalContext}`}>
        <ConclusionSection
          id={`changed-${props.opportunityId}`}
          heading="Что изменилось"
          conclusion={props.card.whatChanged}
          opportunityId={props.opportunityId}
        />
        <ConclusionSection
          id={`not-ordinary-${props.opportunityId}`}
          heading="Почему это не обычный найм"
          conclusion={props.card.whyNotOrdinaryHiring}
          opportunityId={props.opportunityId}
        />
        <ConclusionSection
          id={`why-agency-${props.opportunityId}`}
          heading="Почему может понадобиться агентство"
          conclusion={props.card.whyAgency}
          opportunityId={props.opportunityId}
        />
        <ConclusionSection
          id={`why-this-agency-${props.opportunityId}`}
          heading="Почему подходит именно это агентство"
          conclusion={props.card.whyThisAgency}
          opportunityId={props.opportunityId}
        />
        <ConclusionSection
          id={`why-now-${props.opportunityId}`}
          heading="Почему сейчас"
          conclusion={props.card.whyNow}
          opportunityId={props.opportunityId}
        />
      </div>

      <section
        className={styles.signalMetricsSection}
        aria-labelledby={`signal-metrics-${props.opportunityId}`}
      >
        <h3 id={`signal-metrics-${props.opportunityId}`}>
          Компоненты решения
        </h3>
        <div className={styles.signalMetrics}>
          <Metric
            heading="External Agency Propensity"
            metric={props.card.metrics.externalAgencyPropensity}
          />
          <Metric heading="Agency Fit" metric={props.card.metrics.agencyFit} />
          <Metric
            heading="Opportunity Quality"
            metric={props.card.metrics.opportunityQuality}
          />
          <Metric
            heading="Actionability"
            metric={props.card.metrics.actionability}
          />
        </div>
      </section>

      <div className={styles.decisionGrid}>
        <ConclusionSection
          id={`recommended-action-${props.opportunityId}`}
          heading="Рекомендуемое действие"
          conclusion={props.card.recommendedAction}
          opportunityId={props.opportunityId}
        />
        <Constraints
          opportunityId={props.opportunityId}
          values={props.card.constraints}
        />
      </div>
    </div>
  )
}

function ConclusionSection(props: {
  id: string
  heading: string
  conclusion: CommercialSignalCardConclusion
  opportunityId: string
}) {
  return (
    <section className={styles.decisionSection} aria-labelledby={props.id}>
      <h3 id={props.id}>{props.heading}</h3>
      <p>{props.conclusion.text}</p>
      <ConclusionBasis
        conclusion={props.conclusion}
        opportunityId={props.opportunityId}
      />
    </section>
  )
}

function Constraints(props: {
  opportunityId: string
  values: CommercialSignalCardConclusion[]
}) {
  const headingId = `commercial-constraints-${props.opportunityId}`
  return (
    <section className={styles.decisionSection} aria-labelledby={headingId}>
      <h3 id={headingId}>Ограничения</h3>
      <ul className={styles.signalConstraints}>
        {props.values.map((value, index) => (
          <li key={`${value.basis}:${index}:${value.text}`}>
            <p>{value.text}</p>
            <ConclusionBasis
              conclusion={value}
              opportunityId={props.opportunityId}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ConclusionBasis(props: {
  conclusion: CommercialSignalCardConclusion
  opportunityId: string
}) {
  return (
    <div className={styles.conclusionBasis} data-basis={props.conclusion.basis}>
      <span>
        {props.conclusion.basis === 'evidence'
          ? 'Основано на доказательствах'
          : 'Гипотеза — проверьте вручную'}
      </span>
      {props.conclusion.evidenceIds.length > 0 ? (
        <a href={`#evidence-${props.opportunityId}`}>
          Подтверждения: {props.conclusion.evidenceIds
            .map((id) => `№${id}`).join(', ')}
        </a>
      ) : null}
    </div>
  )
}

function Metric(props: {
  heading: string
  metric: CommercialSignalCardMetric
}) {
  const level = metricLevel(props.metric.value)
  return (
    <section className={styles.signalMetric} data-level={level.key}>
      <h3>{props.heading}</h3>
      <strong>{level.label}</strong>
      <span className={styles.signalMetricBar} aria-hidden="true" />
      <small>Причины: {props.metric.reasonCodes.join(', ')}</small>
    </section>
  )
}

function metricLevel(value: number): {
  key: 'low' | 'medium' | 'high'
  label: 'Низкая' | 'Средняя' | 'Высокая'
} {
  if (value >= 0.75) return { key: 'high', label: 'Высокая' }
  if (value >= 0.5) return { key: 'medium', label: 'Средняя' }
  return { key: 'low', label: 'Низкая' }
}
