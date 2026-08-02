import { SlidingWindowRateLimiter } from '@/lib/rate-limiter'

const WORKSPACE_DELIVERY_RATE_LIMIT = new SlidingWindowRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
})
const GLOBAL_DELIVERY_RATE_LIMIT = new SlidingWindowRateLimiter({
  maxRequests: 1_000,
  windowMs: 60_000,
})

export async function checkCrmDeliveryRateLimit(
  workspaceId: string | number,
): Promise<boolean> {
  if (!(await WORKSPACE_DELIVERY_RATE_LIMIT.isAllowed(
    `opportunity-crm-delivery:workspace:${workspaceId}`,
  ))) return false
  return GLOBAL_DELIVERY_RATE_LIMIT.isAllowed('opportunity-crm-delivery:global')
}

export async function resetCrmDeliveryRateLimitsForTests(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') return
  await Promise.all([
    WORKSPACE_DELIVERY_RATE_LIMIT.reset(),
    GLOBAL_DELIVERY_RATE_LIMIT.reset(),
  ])
}
