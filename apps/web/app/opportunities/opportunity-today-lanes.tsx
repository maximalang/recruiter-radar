import Link from 'next/link'

import type {
  OpportunityOutcomeOperationalSummary,
  OpportunityView,
} from '@/lib/opportunities/repository'
import styles from './opportunities.module.css'

const LANES: ReadonlyArray<{
  label: string
  view: OpportunityView
  count: keyof OpportunityOutcomeOperationalSummary
  tone: 'neutral' | 'attention' | 'danger'
}> = [
  { label: 'Новые ситуации', view: 'morning', count: 'newCount', tone: 'neutral' },
  { label: 'Связаться', view: 'accepted', count: 'acceptedCount', tone: 'attention' },
  { label: 'Повторный контакт', view: 'follow_up', count: 'followUpCount', tone: 'neutral' },
  { label: 'Просрочено', view: 'overdue', count: 'overdueCount', tone: 'danger' },
  { label: 'Активная работа', view: 'pipeline', count: 'pipelineCount', tone: 'neutral' },
]

export function OpportunityTodayLanes(props: {
  summary: OpportunityOutcomeOperationalSummary | null
  activeView: OpportunityView
}) {
  return (
    <section className={styles.workflowLedger} aria-labelledby="situation-workflow-title">
      <div className={styles.workflowLedgerHeader}>
        <h2 id="situation-workflow-title">Рабочий контур</h2>
        <span>Состояние действий по ситуациям</span>
      </div>
      <nav className={styles.todayLanes} aria-label="Рабочий контур ситуаций">
        {LANES.map((lane) => (
          <Link
            key={lane.view}
            href={`/opportunities?view=${lane.view}`}
            className={styles.todayLane}
            data-tone={lane.tone}
            data-active={props.activeView === lane.view ? 'true' : undefined}
            aria-current={props.activeView === lane.view ? 'page' : undefined}
          >
            <span>{lane.label}</span>
            <strong>{props.summary?.[lane.count] ?? 0}</strong>
            <i aria-hidden="true">→</i>
          </Link>
        ))}
      </nav>
    </section>
  )
}
