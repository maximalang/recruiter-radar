export type ChannelDeliveryState =
  | 'not_attempted'
  | 'processing'
  | 'sent'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'skipped_not_configured'
  | 'skipped_disabled'
  | 'already_successfully_delivered'

export type PersistedChannelDeliveryState = Exclude<ChannelDeliveryState, 'sent' | 'not_attempted' | 'skipped_not_configured' | 'skipped_disabled'>

export function persistedChannelDeliveryState(status: string | null | undefined): PersistedChannelDeliveryState | null {
  if (!status) return null
  if (status === 'sent') return 'already_successfully_delivered'
  if (status === 'processing') return 'processing'
  if (status === 'failed_retryable') return 'failed_retryable'
  if (status === 'failed_terminal' || status === 'failed' || status === 'partial') {
    return 'failed_terminal'
  }
  return 'failed_terminal'
}

export function isChannelDeliveryFailure(state: ChannelDeliveryState): boolean {
  return state === 'processing' || state === 'failed_retryable' || state === 'failed_terminal'
}
