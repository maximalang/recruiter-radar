import Link from 'next/link'

import type { OpportunityView } from '@/lib/opportunities/repository'
import styles from './opportunities.module.css'

export function OpportunityResearchMode(props: {
  view: OpportunityView
  query: string
  confidenceGate: string
  workflowEnabled: boolean
  children?: React.ReactNode
}) {
  const active = Boolean(
    props.query || props.confidenceGate ||
    props.view === 'completed' || props.view === 'all' ||
    (!props.workflowEnabled && props.view !== 'morning'),
  )

  return (
    <details className={styles.researchMode} open={active || undefined}>
      <summary>Режим исследования</summary>
      <div className={styles.researchBody}>
        <form action="/opportunities" method="get" className={styles.researchForm}>
          <input type="hidden" name="view" value={props.view} />
          <label className={styles.researchSearch}>
            <span>Компания или возможность</span>
            <input
              type="search"
              name="q"
              defaultValue={props.query}
              maxLength={80}
              autoComplete="off"
            />
          </label>
          <label>
            <span>Уровень уверенности</span>
            <select name="gate" defaultValue={props.confidenceGate}>
              <option value="">Все уровни</option>
              <option value="A">A — прямые подтверждения</option>
              <option value="B">B — сильный источник</option>
              <option value="C">C — нужна проверка</option>
              <option value="D">D — только контекст</option>
            </select>
          </label>
          <div className={styles.researchActions}>
            <button type="submit">Найти</button>
            {props.query || props.confidenceGate ? (
              <Link href={`/opportunities?view=${props.view}`}>Сбросить</Link>
            ) : null}
          </div>
        </form>

        <nav className={styles.filters} aria-label="Исследовательские представления">
          <ResearchLink href="/opportunities?view=today" active={props.view === 'today'}>
            Сегодня
          </ResearchLink>
          {!props.workflowEnabled ? (
            <>
              <ResearchLink href="/opportunities?view=morning" active={props.view === 'morning'}>
                Новые
              </ResearchLink>
              <ResearchLink href="/opportunities?view=accepted" active={props.view === 'accepted'}>
                В работе
              </ResearchLink>
              <ResearchLink href="/opportunities?view=snoozed" active={props.view === 'snoozed'}>
                Отложенные
              </ResearchLink>
            </>
          ) : null}
          <ResearchLink href="/opportunities?view=completed" active={props.view === 'completed'}>
            Завершённые
          </ResearchLink>
          <ResearchLink href="/opportunities?view=all" active={props.view === 'all'}>
            Все
          </ResearchLink>
        </nav>

        {props.children}
      </div>
    </details>
  )
}

function ResearchLink(props: {
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
