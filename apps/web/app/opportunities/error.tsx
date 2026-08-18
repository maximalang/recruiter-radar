'use client'

import { useEffect, useMemo } from 'react'

import { ProductErrorState } from '../ui/product-error-state'
import { InternalPageFrame, InternalPageHeader } from '../ui/internal-page'
import { buildOpportunityNavigation } from './navigation'

export default function OpportunitiesError(props: { error?: Error & { digest?: string }; reset: () => void }) {
  const correlationId = useMemo(
    () => props.error?.digest ?? crypto.randomUUID(),
    [props.error],
  )

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
