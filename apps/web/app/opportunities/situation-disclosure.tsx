'use client'

import { useId, useState, type ReactNode } from 'react'
import styles from './situation-row.module.css'

export function SituationDisclosure({
  header,
  children,
}: {
  header: ReactNode
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return (
    <>
      <div className={styles.summary} data-state={expanded ? 'expanded' : 'collapsed'}>
        {header}
        <button
          type="button"
          className={styles.cue}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Скрыть анализ' : 'Анализ'}
          <span aria-hidden="true"> {expanded ? '↑' : '↓'}</span>
        </button>
      </div>
      <div
        id={contentId}
        className={styles.detail}
        data-state={expanded ? 'expanded' : 'collapsed'}
        hidden={!expanded}
      >
        {children}
      </div>
    </>
  )
}
