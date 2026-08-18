'use client'

import { useEffect, useMemo } from 'react'

import { ProductErrorState } from '../ui/product-error-state'
import { InternalPageFrame, InternalPageHeader } from '../ui/internal-page'
import { buildOpportunityNavigation } from './navigation'

export default function OpportunitiesError(props: { error?: Error & { digest?: string }; reset: () => void }) {
  const correlationId = useMemo(
    () => props.error?.digest ?? createCorrelationId(),
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

function createCorrelationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const entropy = new Uint32Array(4)
  crypto.getRandomValues(entropy)
  return Array.from(
    entropy,
    (value) => value.toString(16).padStart(8, '0'),
  ).join('')
}
