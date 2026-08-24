'use client'

import { type ReactNode } from 'react'
import styles from './situation-row.module.css'

export function SituationDisclosure({
  header,
  children,
}: {
  header: ReactNode
  children: ReactNode
}) {
  return (
    <details className={styles.disclosure}>
      <summary className={styles.summary}>
        {header}
        <span className={styles.cue}>
          Анализ
          <span aria-hidden="true"> ↓</span>
        </span>
      </summary>
      <div className={styles.detail}>
        {children}
      </div>
    </details>
  )
}
