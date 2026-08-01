import {
  EvidenceTag,
  GateBadgeInline,
} from '../ui/internal-page'
import type { OpportunityItem } from '@/lib/opportunities/repository'
import type {
  OpportunityStrategistBrief,
  OpportunityStrategistConclusion,
} from '@/lib/opportunities/opportunity-strategist-v1'
import { OpportunityActions } from './opportunity-actions'
import {
  OpportunityOutcomeImpression,
  OpportunityOutcomePanel,
} from './opportunity-outcome-panel'
import styles from './opportunities.module.css'

const EPISODE_LABELS: Record<string, string> = {
  vacancy_spike: 'Всплеск найма',
  repeated_vacancies: 'Повторные вакансии',
  role_cluster: 'Кластер ролей',
  new_region: 'Новый регион',
  hiring_restart: 'Возобновление найма',
  sustained_hiring: 'Устойчивый найм',
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  review: 'Нужна проверка',
  accepted: 'В работе',
  dismissed: 'Не подходит',
  snoozed: 'Отложена',
  contacted: 'Связались',
  replied: 'Ответили',
  meeting: 'Встреча',
  proposal: 'Предложение',
  won: 'Успешно',
  lost: 'Проиграно',
  expired: 'Истекла',
}

export function OpportunityCard(props: {
  opportunity: OpportunityItem
  outcomesUiEnabled?: boolean
  trackingCycleId?: string | null
}) {
  const opportunity = props.opportunity
  const score = Math.round(opportunity.opportunityScore * 100)
  const displayStatus = opportunity.workflowState === 'snoozed'
    ? 'snoozed'
    : opportunity.commercialStage

  return (
    <article className={styles.card} data-status={displayStatus}>
      {props.outcomesUiEnabled && props.trackingCycleId ? (
        <OpportunityOutcomeImpression
          opportunityId={opportunity.id}
          cycleId={props.trackingCycleId}
        />
      ) : null}
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.eyebrow}>
            {EPISODE_LABELS[opportunity.episodeType] ?? opportunity.episodeType}
            <span aria-hidden="true"> · </span>
            {STATUS_LABELS[displayStatus] ?? displayStatus}
          </div>
          <h2 className={styles.cardTitle}>{opportunity.title}</h2>
          <p className={styles.organization}>
            {opportunity.organizationName}
            {opportunity.organizationDomain
              ? ` · ${opportunity.organizationDomain}`
              : ''}
          </p>
        </div>
        <div className={styles.score} aria-label={`Оценка возможности: ${score} из 100`}>
          <strong>{score}</strong>
          <span>/ 100</span>
        </div>
      </div>

      <div className={styles.badges}>
        <GateBadgeInline gate={opportunity.confidenceGate} />
        <EvidenceTag>
          {opportunity.factCount} фактов · {opportunity.sourceFamilyCount} источника ·{' '}
          {opportunity.directEvidenceCount} прямое подтверждение
        </EvidenceTag>
        <EvidenceTag>
          актуально до {formatDate(opportunity.validUntil)}
        </EvidenceTag>
      </div>

      {opportunity.strategistBrief ? (
        <StrategistCard
          opportunityId={opportunity.id}
          brief={opportunity.strategistBrief}
        />
      ) : (
        <div className={styles.briefGrid}>
          <BriefField label="Что изменилось" value={opportunity.whyNow} />
          <BriefField
            label="Почему это может быть важно"
            value={opportunity.problemHypothesis}
          />
          <BriefField
            label="Почему подходит агентству"
            value={opportunity.agencyFitExplanation}
          />
          <BriefField label="Рекомендуемый заход" value={opportunity.recommendedAngle} />
          <BriefField label="Кому адресовать" value={opportunity.recommendedPersona} />
        </div>
      )}

      <section className={styles.evidenceSection} aria-labelledby={`evidence-${opportunity.id}`}>
        <div className={styles.sectionHeading}>
          <h3 id={`evidence-${opportunity.id}`}>Лента доказательств</h3>
          <span>
            {formatDate(opportunity.episodeStartedAt)} — {formatDate(opportunity.episodeLastSeenAt)}
          </span>
        </div>
        {opportunity.evidenceTimeline.length > 0 ? (
          <ol className={styles.timeline}>
            {opportunity.evidenceTimeline.map((item) => {
              const safeUrl = safeEvidenceUrl(item.url)
              return (
                <li key={`${item.kind}:${item.id}`} className={styles.timelineItem}>
                  <span className={styles.timelineDot} aria-hidden="true" />
                  <div>
                    <span className={styles.timelineDate}>{formatDate(item.occurredAt)}</span>
                    {safeUrl ? (
                      <a href={safeUrl} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                    ) : (
                      <strong>{item.title}</strong>
                    )}
                    <small>
                      {item.source}
                      {item.tier ? ` · ${tierLabel(item.tier)}` : ''}
                    </small>
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className={styles.evidenceFallback}>
            Источники связаны с эпизодом, но их публичное представление пока недоступно.
          </p>
        )}
      </section>

      <div className={styles.recommendedAction}>
        <span>Следующий шаг</span>
        <p>
          {opportunity.strategistBrief?.recommendedNextAction.text ??
            opportunity.recommendedAction}
        </p>
        {opportunity.strategistBrief ? (
          <ConclusionBasis
            value={opportunity.strategistBrief.recommendedNextAction}
          />
        ) : null}
      </div>

      {props.outcomesUiEnabled ? (
        <OpportunityOutcomePanel
          opportunityId={opportunity.id}
          fallbackStage={opportunity.commercialStage}
        />
      ) : (
        <OpportunityActions
          opportunityId={opportunity.id}
          currentStatus={opportunity.status}
          detailHref={`#evidence-${opportunity.id}`}
        />
      )}
    </article>
  )
}

function StrategistCard(props: {
  opportunityId: string
  brief: OpportunityStrategistBrief
}) {
  const headingId = `strategist-${props.opportunityId}`
  return (
    <section className={styles.strategistCard} aria-labelledby={headingId}>
      <div className={styles.strategistHeading}>
        <h3 id={headingId}>Стратегическая карточка</h3>
        <span>evidence-bound v1</span>
      </div>
      <div className={styles.briefGrid}>
        <StrategistField label="Что изменилось" value={props.brief.whatChanged} />
        <StrategistField label="Почему сейчас" value={props.brief.whyNow} />
        <StrategistField label="Гипотеза проблемы" value={props.brief.problemHypothesis} />
        <StrategistField
          label="Почему подходит агентству"
          value={props.brief.agencyFitExplanation}
        />
        <StrategistField
          label="Нужна ли внешняя поддержка"
          value={props.brief.externalSupportNeedExplanation}
        />
        <StrategistField label="Кому адресовать" value={props.brief.recommendedPersona} />
        <StrategistField label="Рекомендуемый заход" value={props.brief.recommendedAngle} />
        <StrategistField label="Релевантный кейс" value={props.brief.recommendedCaseStudy} />
      </div>
      <StrategistList label="Риски" values={props.brief.riskSignals} />
      <StrategistList label="Ограничения" values={props.brief.limitations} />
    </section>
  )
}

function StrategistField(props: {
  label: string
  value: OpportunityStrategistConclusion
}) {
  return (
    <div className={styles.briefField}>
      <span>{props.label}</span>
      <p>{props.value.text}</p>
      <ConclusionBasis value={props.value} />
    </div>
  )
}

function StrategistList(props: {
  label: string
  values: OpportunityStrategistConclusion[]
}) {
  if (props.values.length === 0) return null
  return (
    <div className={styles.strategistList}>
      <span>{props.label}</span>
      <ul>
        {props.values.map((value, index) => (
          <li key={`${value.basis}:${index}:${value.text}`}>
            <p>{value.text}</p>
            <ConclusionBasis value={value} />
          </li>
        ))}
      </ul>
    </div>
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

function BriefField(props: { label: string; value: string }) {
  return (
    <div className={styles.briefField}>
      <span>{props.label}</span>
      <p>{props.value}</p>
    </div>
  )
}

function formatDate(value: string | null): string {
  if (!value) return 'без срока'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'дата не указана'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp))
}

function safeEvidenceUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function tierLabel(value: string): string {
  if (value === 'direct') return 'прямое подтверждение'
  if (value === 'corroboration') return 'подтверждение'
  return 'контекст'
}
