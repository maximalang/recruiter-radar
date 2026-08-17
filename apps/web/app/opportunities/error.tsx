'use client'

import {
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
} from '../ui/internal-page'
import { buildOpportunityNavigation } from './navigation'
import styles from './opportunities.module.css'

export default function OpportunitiesError(props: { reset: () => void }) {
  return (
    <InternalPageFrame navItems={buildOpportunityNavigation()}>
      <InternalPageHeader title="Ситуации" />
      <ErrorState
        title="Ситуации временно не загрузились"
        description="Повторите загрузку. Данные других аккаунтов при ошибке не показываются."
      />
      <div className={styles.errorAction}>
        <button
          type="button"
          className={styles.actionButton}
          data-tone="primary"
          onClick={props.reset}
        >
          Попробовать снова
        </button>
      </div>
    </InternalPageFrame>
  )
}
