'use client'

import { useEffect } from 'react'

import { ProductErrorState } from '../ui/product-error-state'
import { InternalPageFrame, InternalPageHeader } from '../ui/internal-page'
import { buildOpportunityNavigation } from './navigation'
import styles from './opportunities.module.css'

export default function OpportunitiesError(props: { error?: Error & { digest?: string }; reset: () => void }) {
  const correlationId = props.error?.digest ?? crypto.randomUUID()

  useEffect(() => {
    console.error('[opportunities] route render failed', {
      correlationId,
      name: props.error?.name,
    })
  }, [correlationId, props.error])

  return (
    <InternalPageFrame navItems={buildOpportunityNavigation()}>
      <InternalPageHeader title="Ситуации" />
      <ProductErrorState
        title="Ситуации временно не загрузились"
        description="Повторите загрузку. Данные других аккаунтов при ошибке не показываются."
        correlationId={correlationId}
        retryAction={{ label: 'Попробовать снова', onClick: props.reset }}
      />
    </InternalPageFrame>
  )
}
