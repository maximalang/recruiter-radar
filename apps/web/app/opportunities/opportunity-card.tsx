import {
  EvidenceTag,
  GateBadgeInline,
} from '../ui/internal-page'
import type { OpportunityItem } from '@/lib/opportunities/repository'
import type { WorkspaceRole } from '@/lib/auth-v2/workspaces'
import type { OpportunityWorkflowAssignee } from '@/lib/opportunities/opportunity-workflow-repository'
import { parseCommercialSignalCard } from '@/lib/opportunities/commercial-signal-card'
import { OpportunityActions } from './opportunity-actions'
import {
  OpportunityDecisionContext,
  OpportunityDecisionPlan,
} from './opportunity-decision-brief'
import { OpportunityEvidenceSection } from './opportunity-evidence'
import {
  OpportunityOutcomeImpression,
  OpportunityOutcomePanel,
} from './opportunity-outcome-panel'
import { OpportunityWorkflowPanel } from './opportunity-workflow-panel'
import {
  OpportunityCommercialSignalCard,
} from './opportunity-commercial-signal-card'
import styles from './opportunities.module.css'
import { pluralForm } from '@/lib/format/plural'

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
  workflowEnabled?: boolean
  workflowAssignees?: OpportunityWorkflowAssignee[]
  actorUserId?: string
  actorRole?: WorkspaceRole | null
  commercialSignalUiEnabled?: boolean
}) {
  const opportunity = props.opportunity
  const score = Math.round(opportunity.opportunityScore * 100)
  const commercialSignalCard = props.commercialSignalUiEnabled
    ? parseCommercialSignalCard(
        opportunity.metadata?.commercialSignalCard,
        new Set(opportunity.evidenceTimeline
          .filter((item) => item.kind === 'evidence')
          .map((item) => item.id)),
      )
    : null
  const displayStatus = opportunity.workflowState === 'snoozed'
    ? 'snoozed'
    : opportunity.commercialStage
  const contentState = props.commercialSignalUiEnabled
    ? commercialSignalCard ? 'complete' : 'insufficient'
    : opportunity.strategistBrief ? 'complete' : 'insufficient'
  const freshness = isStale(opportunity.validUntil) ? 'stale' : 'current'

  return (
    <article
      className={styles.card}
      data-status={displayStatus}
      data-content-state={contentState}
      data-freshness={freshness}
      data-semantic-mode={props.commercialSignalUiEnabled ? 'v3' : 'legacy'}
    >
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
          <h2 className={styles.cardTitle}>{opportunity.organizationName}</h2>
          <p className={styles.organization}>
            {opportunity.title}
            {opportunity.organizationDomain
              ? ` · ${opportunity.organizationDomain}`
              : ''}
          </p>
        </div>
        {!props.commercialSignalUiEnabled ? (
          <div className={styles.score} aria-label={`Оценка возможности: ${score} из 100`}>
            <strong>{score}</strong>
            <span>/ 100</span>
          </div>
        ) : null}
      </div>

      <div className={styles.badges}>
        {!props.commercialSignalUiEnabled ? (
          <GateBadgeInline gate={opportunity.confidenceGate} />
        ) : null}
        <EvidenceTag>
          {formatCount(opportunity.factCount, ['факт', 'факта', 'фактов'])} ·{' '}
          {formatCount(opportunity.sourceFamilyCount, ['источник', 'источника', 'источников'])} ·{' '}
          {formatCount(opportunity.directEvidenceCount, [
            'прямое подтверждение',
            'прямых подтверждения',
            'прямых подтверждений',
          ])}
        </EvidenceTag>
        <EvidenceTag>
          актуально до {formatDate(opportunity.validUntil)}
        </EvidenceTag>
      </div>

      {props.commercialSignalUiEnabled && !commercialSignalCard ? (
        <p className={styles.cardState} data-state="insufficient" role="status">
          Данных для новой оценки коммерческой возможности пока недостаточно.
          Предыдущая оценка не подставляется вместо неё.
        </p>
      ) : contentState === 'insufficient' ? (
        <p className={styles.cardState} data-state="insufficient" role="status">
          Для части выводов пока недостаточно подтверждённых данных.
        </p>
      ) : null}
      {freshness === 'stale' ? (
        <p className={styles.cardState} data-state="stale" role="status">
          Срок актуальности закончился {formatDate(opportunity.validUntil)}. Проверьте
          доказательства перед действием.
        </p>
      ) : null}

      {commercialSignalCard ? (
        <OpportunityCommercialSignalCard
          opportunityId={opportunity.id}
          card={commercialSignalCard}
        />
      ) : !props.commercialSignalUiEnabled ? (
        <OpportunityDecisionContext opportunity={opportunity} />
      ) : null}
      <OpportunityEvidenceSection opportunity={opportunity} />
      {!props.commercialSignalUiEnabled ? (
        <OpportunityDecisionPlan opportunity={opportunity} />
      ) : null}

      {props.workflowEnabled && props.actorUserId ? (
        <OpportunityWorkflowPanel
          opportunityId={opportunity.id}
          workflow={opportunity.workflow}
          assignees={props.workflowAssignees ?? []}
          actorUserId={props.actorUserId}
          actorRole={props.actorRole ?? null}
        />
      ) : null}

      <section
        className={`${styles.decisionSection} ${styles.commercialHistory}`}
        aria-labelledby={`commercial-history-${opportunity.id}`}
      >
        <h3 id={`commercial-history-${opportunity.id}`}>Коммерческая история</h3>
        {props.outcomesUiEnabled ? (
          <OpportunityOutcomePanel
            opportunityId={opportunity.id}
            fallbackStage={opportunity.commercialStage}
          />
        ) : (
          <>
            <p className={styles.insufficientValue}>
              История недоступна в текущем режиме.
            </p>
            <OpportunityActions
              opportunityId={opportunity.id}
              currentStatus={opportunity.status}
              detailHref={`#evidence-${opportunity.id}`}
            />
          </>
        )}
      </section>
    </article>
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

function isStale(value: string | null): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp < Date.now()
}

function formatCount(count: number, forms: readonly [string, string, string]): string {
  return `${count} ${pluralForm(count, forms)}`
}
