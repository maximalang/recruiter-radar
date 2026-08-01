import type { OpportunityItem } from '@/lib/opportunities/repository'
import type { OpportunityStrategistConclusion } from '@/lib/opportunities/opportunity-strategist-v1'
import styles from './opportunities.module.css'

const INSUFFICIENT_COPY = 'Недостаточно подтверждённых данных.'

export function OpportunityDecisionContext(props: { opportunity: OpportunityItem }) {
  const brief = props.opportunity.strategistBrief

  return (
    <div className={`${styles.decisionGrid} ${styles.decisionContext}`}>
      <DecisionSection
        id={`changed-${props.opportunity.id}`}
        heading="Что изменилось"
        value={brief?.whatChanged ?? props.opportunity.whyNow}
      />
      <DecisionSection
        id={`why-now-${props.opportunity.id}`}
        heading="Почему сейчас"
        value={brief?.whyNow ?? null}
      />
      <DecisionSection
        id={`agency-fit-${props.opportunity.id}`}
        heading="Почему подходит агентству"
        value={brief?.agencyFitExplanation ?? props.opportunity.agencyFitExplanation}
      />
    </div>
  )
}

export function OpportunityDecisionPlan(props: { opportunity: OpportunityItem }) {
  const brief = props.opportunity.strategistBrief

  return (
    <div className={styles.decisionGrid}>
      <DecisionSection
        id={`task-${props.opportunity.id}`}
        heading="Предполагаемая задача"
        value={brief?.problemHypothesis ?? props.opportunity.problemHypothesis}
      />
      <DecisionSection
        id={`persona-${props.opportunity.id}`}
        heading="Рекомендуемая персона"
        value={brief?.recommendedPersona ?? props.opportunity.recommendedPersona}
      />
      <DecisionSection
        id={`angle-${props.opportunity.id}`}
        heading="Рекомендуемый заход"
        value={brief?.recommendedAngle ?? props.opportunity.recommendedAngle}
      />
      <DecisionSection
        id={`case-${props.opportunity.id}`}
        heading="Релевантный кейс"
        value={brief?.recommendedCaseStudy ?? null}
      />
      <LimitationsSection opportunity={props.opportunity} />
      <DecisionSection
        id={`next-action-${props.opportunity.id}`}
        heading="Следующее действие"
        value={brief?.recommendedNextAction ?? props.opportunity.recommendedAction}
      />
    </div>
  )
}

function DecisionSection(props: {
  id: string
  heading: string
  value: OpportunityStrategistConclusion | string | null
}) {
  const hasValue = typeof props.value === 'string'
    ? props.value.trim().length > 0
    : Boolean(props.value?.text.trim())

  return (
    <section
      className={styles.decisionSection}
      aria-labelledby={props.id}
      data-state={hasValue ? 'available' : 'insufficient'}
    >
      <h3 id={props.id}>{props.heading}</h3>
      {hasValue ? (
        <>
          <p>{typeof props.value === 'string' ? props.value : props.value?.text}</p>
          {typeof props.value === 'object' && props.value ? (
            <ConclusionBasis value={props.value} />
          ) : null}
        </>
      ) : (
        <p className={styles.insufficientValue}>{INSUFFICIENT_COPY}</p>
      )}
    </section>
  )
}

function LimitationsSection(props: { opportunity: OpportunityItem }) {
  const brief = props.opportunity.strategistBrief
  const risks = brief?.riskSignals ?? []
  const limitations = brief?.limitations ?? []
  const hasValues = risks.length > 0 || limitations.length > 0
  const headingId = `limitations-${props.opportunity.id}`

  return (
    <section
      className={styles.decisionSection}
      aria-labelledby={headingId}
      data-state={hasValues ? 'available' : 'insufficient'}
    >
      <h3 id={headingId}>Ограничения</h3>
      {hasValues ? (
        <>
          {risks.length > 0 ? (
            <div className={styles.decisionList}>
              <span>Риски</span>
              <ConclusionList values={risks} />
            </div>
          ) : null}
          {limitations.length > 0 ? <ConclusionList values={limitations} /> : null}
        </>
      ) : (
        <p className={styles.insufficientValue}>{INSUFFICIENT_COPY}</p>
      )}
    </section>
  )
}

function ConclusionList(props: { values: OpportunityStrategistConclusion[] }) {
  return (
    <ul>
      {props.values.map((value, index) => (
        <li key={`${value.basis}:${index}:${value.text}`}>
          <p>{value.text}</p>
          <ConclusionBasis value={value} />
        </li>
      ))}
    </ul>
  )
}

function ConclusionBasis(props: { value: OpportunityStrategistConclusion }) {
  return (
    <div className={styles.conclusionBasis} data-basis={props.value.basis}>
      <span>
        {props.value.basis === 'evidence'
          ? 'Основано на доказательствах'
          : 'Гипотеза — проверьте вручную'}
      </span>
      {props.value.supportingEvidenceIds.length > 0 ? (
        <small>
          Подтверждения: {props.value.supportingEvidenceIds
            .map((id) => `№${id}`).join(', ')}
        </small>
      ) : null}
    </div>
  )
}
