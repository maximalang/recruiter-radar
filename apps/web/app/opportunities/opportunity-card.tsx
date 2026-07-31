import type { CSSProperties } from 'react'

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
import styles from './opportunities-v2.module.css'

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
  const scoreStyle = {
    '--score-angle': `${score * 3.6}deg`,
  } as CSSProperties

  return (
    <article className={styles.card} data-status={displayStatus}>
      {props.outcomesUiEnabled && props.trackingCycleId ? (
        <OpportunityOutcomeImpression
          opportunityId={opportunity.id}
          cycleId={props.trackingCycleId}
        />
      ) : null}

      <div className={styles.cardChrome}>
        <div className={styles.cardStatusLine}>
          <span className={styles.episodeTag}>
            {EPISODE_LABELS[opportunity.episodeType] ?? opportunity.episodeType}
          </span>
          <span className={styles.statusTag}>
            {STATUS_LABELS[displayStatus] ?? displayStatus}
          </span>
        </div>
        <span className={styles.validUntil}>
          окно актуально до {formatDate(opportunity.validUntil)}
        </span>
      </div>

      <div className={styles.cardLead}>
        <div className={styles.identity}>
          <div className={styles.eyebrow}>Opportunity brief</div>
          <h2 className={styles.cardTitle}>{opportunity.title}</h2>
          <p className={styles.organization}>
            {opportunity.organizationName}
            {opportunity.organizationDomain
              ? ` · ${opportunity.organizationDomain}`
              : ''}
          </p>

          <div className={styles.badges}>
            <GateBadgeInline gate={opportunity.confidenceGate} />
            <EvidenceTag>
              {opportunity.factCount} фактов · {opportunity.sourceFamilyCount} источника
            </EvidenceTag>
            <EvidenceTag>
              {opportunity.directEvidenceCount} прямое подтверждение
            </EvidenceTag>
          </div>
        </div>

        <div
          className={styles.scoreDial}
          style={scoreStyle}
          aria-label={`Оценка возможности: ${score} из 100`}
        >
          <div className={styles.scoreDialInner}>
            <strong>{score}</strong>
            <span>opportunity score</span>
          </div>
        </div>
      </div>

      <section className={styles.whyNowBlock} aria-label="Почему сейчас">
        <span className={styles.whyNowLabel}>Почему сейчас</span>
        <p className={styles.whyNowText}>{opportunity.whyNow}</p>
      </section>

      <div className={styles.briefGrid}>
        <BriefField
          label="Коммерческая гипотеза"
          value={opportunity.problemHypothesis}
        />
        <BriefField
          label="Почему подходит агентству"
          value={opportunity.agencyFitExplanation}
        />
        <BriefField
          label="Сила доказательств"
          value={`${opportunity.factCount} связанных фактов из ${opportunity.sourceFamilyCount} семейств источников; прямых подтверждений — ${opportunity.directEvidenceCount}.`}
        />
      </div>

      <section className={styles.commercialPlan} aria-label="План коммерческого контакта">
        <div className={styles.commercialPlanHeader}>
          <span>План контакта</span>
          <small>готовый контекст для первого касания</small>
        </div>
        <div className={styles.commercialPlanGrid}>
          <PlanField label="Рекомендуемый заход" value={opportunity.recommendedAngle} />
          <PlanField label="Кому адресовать" value={opportunity.recommendedPersona} />
          <div className={styles.recommendedAction}>
            <span>Следующий шаг</span>
            <p>{opportunity.recommendedAction}</p>
          </div>
        </div>
      </section>

      <details className={styles.evidenceDisclosure} id={`evidence-${opportunity.id}`}>
        <summary className={styles.evidenceSummary}>
          <span className={styles.evidenceSummaryLead}>
            <strong role="heading" aria-level={3}>Лента доказательств</strong>
            <span>
              {opportunity.evidenceTimeline.length} событий, связанных с эпизодом найма
            </span>
          </span>
          <span className={styles.evidenceSummaryMeta}>
            {formatDate(opportunity.episodeStartedAt)} — {formatDate(opportunity.episodeLastSeenAt)}
            <span className={styles.evidenceChevron} aria-hidden="true">+</span>
          </span>
        </summary>

        <div className={styles.evidenceBody}>
          <div className={styles.sectionHeading}>
            <h3>Evidence timeline</h3>
            <span>
              {opportunity.directEvidenceCount} прямых · {opportunity.factCount} всего
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
        </div>
      </details>

      <div className={styles.actionDock}>
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
      </div>
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

function PlanField(props: { label: string; value: string }) {
  return (
    <div className={styles.planField}>
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
