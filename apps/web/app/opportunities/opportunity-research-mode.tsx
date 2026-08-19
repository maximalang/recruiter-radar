'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import type { OpportunityView } from '@/lib/opportunities/repository'
import styles from './opportunities.module.css'
import disclosureStyles from './opportunity-research-mode.module.css'

type ResearchModeProps = {
  view: OpportunityView
  query: string
  confidenceGate: string
  workflowEnabled: boolean
}

export function OpportunityResearchMode(props: ResearchModeProps & {
  children?: React.ReactNode
}) {
  const hasExplicitCriteria = Boolean(props.query || props.confidenceGate)
  const [mobileOpen, setMobileOpen] = useState(hasExplicitCriteria)

  useEffect(() => {
    setMobileOpen(Boolean(props.query || props.confidenceGate))
  }, [props.view, props.query, props.confidenceGate])

  return (
    <section
      className={styles.researchMode}
      aria-label="Поиск и фильтры ситуаций"
    >
      <div className={styles.researchBody}>
        <button
          type="button"
          className={disclosureStyles.mobileToggle}
          aria-expanded={mobileOpen}
          aria-controls="situation-research-controls"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span>Поиск и фильтры</span>
          <small>{viewLabel(props.view)}</small>
          <span className={disclosureStyles.toggleMark} aria-hidden="true">
            {mobileOpen ? '−' : '+'}
          </span>
        </button>

        <div
          id="situation-research-controls"
          className={disclosureStyles.researchControls}
          data-mobile-open={mobileOpen ? 'true' : 'false'}
        >
          <ResearchControls {...props} />
        </div>

        {props.children}
      </div>
    </section>
  )
}

function ResearchControls(props: ResearchModeProps) {
  return (
    <>
      <form action="/opportunities" method="get" className={styles.researchForm}>
        <input type="hidden" name="view" value={props.view} />
        <label className={styles.researchSearch}>
          <span>Компания или ситуация</span>
          <input
            type="search"
            name="q"
            defaultValue={props.query}
            maxLength={80}
            autoComplete="off"
          />
        </label>
        <label>
          <span>Уровень подтверждения</span>
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

      <nav className={styles.filters} aria-label="Представления ситуаций">
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
    </>
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

function viewLabel(view: OpportunityView): string {
  if (view === 'today') return 'Сегодня'
  if (view === 'morning') return 'Новые'
  if (view === 'accepted') return 'В работе'
  if (view === 'follow_up') return 'Следующие касания'
  if (view === 'overdue') return 'Просроченные'
  if (view === 'pipeline') return 'Активная работа'
  if (view === 'snoozed') return 'Отложенные'
  if (view === 'completed') return 'Завершённые'
  return 'Все'
}
