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
  showDiagnostics?: boolean
}) {
  return (
    <div className={styles.commercialSignalBrief}>
      <div className={styles.commercialSignalHeading}>
        <div>
          <span>Коммерческая возможность</span>
          <strong>{STATUS_LABELS[props.card.status]}</strong>
        </div>
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
          heading="Почему это важно"
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
          heading="Почему подходит вашему агентству"
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
          Почему лид в приоритете
        </h3>
        <div className={styles.signalMetrics}>
          <Metric
            heading="Вероятность внешнего подбора"
            metric={props.card.metrics.externalAgencyPropensity}
          />
          <Metric heading="Соответствие вашему профилю" metric={props.card.metrics.agencyFit} />
          <Metric
            heading="Сила возможности"
            metric={props.card.metrics.opportunityQuality}
          />
          <Metric
            heading="Готовность к контакту"
            metric={props.card.metrics.actionability}
          />
        </div>
        {props.showDiagnostics === false ? null : <OpportunitySignalDiagnostics card={props.card} />}
      </section>

      <div className={styles.decisionGrid}>
        <ConclusionSection
          id={`recommended-action-${props.opportunityId}`}
          heading="Что сделать сейчас"
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
      {props.conclusion.basis === 'evidence'
        && props.conclusion.evidenceIds.length > 0 ? (
        <a href={`#evidence-${props.opportunityId}`}>
          Подтверждено · {props.conclusion.evidenceIds
            .map((id) => `№${id}`).join(', ')}
        </a>
      ) : (
        <span>
          {props.conclusion.basis === 'evidence'
            ? 'Подтверждено'
            : 'Гипотеза — проверьте вручную'}
        </span>
      )}
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
    </section>
  )
}

export function OpportunitySignalDiagnostics({ card }: { card: CommercialSignalCard }) {
  const diagnostics = [
    ['Вероятность внешнего подбора', card.metrics.externalAgencyPropensity.reasonCodes],
    ['Соответствие вашему профилю', card.metrics.agencyFit.reasonCodes],
    ['Сила возможности', card.metrics.opportunityQuality.reasonCodes],
    ['Готовность к контакту', card.metrics.actionability.reasonCodes],
  ] as const

  return (
    <details className={styles.signalDiagnostics}>
      <summary>Как радар сделал вывод</summary>
      <dl>
        {diagnostics.map(([label, reasonCodes]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{reasonCodes.join(', ') || 'Код причины не указан'}</dd>
          </div>
        ))}
      </dl>
    </details>
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
