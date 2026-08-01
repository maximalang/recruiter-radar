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
  { label: 'Новые возможности', view: 'morning', count: 'newCount', tone: 'neutral' },
  { label: 'Нужно связаться', view: 'accepted', count: 'acceptedCount', tone: 'attention' },
  { label: 'Ожидают follow-up', view: 'follow_up', count: 'followUpCount', tone: 'neutral' },
  { label: 'Просрочено', view: 'overdue', count: 'overdueCount', tone: 'danger' },
  { label: 'Активный pipeline', view: 'pipeline', count: 'pipelineCount', tone: 'neutral' },
]

export function OpportunityTodayLanes(props: {
  summary: OpportunityOutcomeOperationalSummary | null
  activeView: OpportunityView
}) {
  return (
    <nav className={styles.todayLanes} aria-label="Действия на сегодня">
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
        </Link>
      ))}
    </nav>
  )
}
