import {
  EvidenceTag,
  GateBadgeInline,
} from '../ui/internal-page'
import type { OpportunityItem } from '@/lib/opportunities/repository'
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
  expired: 'Истекла',
}

export function OpportunityCard(props: {
  opportunity: OpportunityItem
  outcomesUiEnabled?: boolean
  trackingCycleId?: string | null
}) {
  const opportunity = props.opportunity
  const score = Math.round(opportunity.opportunityScore * 100)

  return (
    <article className={styles.card} data-status={opportunity.status}>
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
            {STATUS_LABELS[opportunity.status] ?? opportunity.status}
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

      <section className={styles.evidenceSection} aria-labelledby={`evidence-${opportunity.id}`}>
        <div className={styles.sectionHeading}>
          <h3 id={`evidence-${opportunity.id}`}>Лента доказательств</h3>
          <span>
            {formatDate(opportunity.episodeStartedAt)} — {formatDate(opportunity.episodeLastSeenAt)}
          </span>
        </div>
        {opportunity.evidenceTimeline.length > 0 ? (
          <ol className={styles.timeline}>
            {opportunity.evidenceTimeline.slice(0, 6).map((item) => {
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
        <p>{opportunity.recommendedAction}</p>
      </div>

      {props.outcomesUiEnabled ? (
        <OpportunityOutcomePanel
          opportunityId={opportunity.id}
          fallbackStage={opportunity.status}
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
