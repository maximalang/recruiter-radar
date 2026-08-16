export type TimewebMcpRecoveryResult<T> = {
  result: T
  recovered: boolean
}

export async function withSingleTimewebMcpRecovery<T>(
  attempt: () => Promise<T>,
  recover: () => Promise<void>,
  isExpired: (result: T) => boolean,
): Promise<TimewebMcpRecoveryResult<T>> {
  let result = await attempt()
  if (!isExpired(result)) return { result, recovered: false }

  await recover()
  result = await attempt()
  return { result, recovered: true }
}
