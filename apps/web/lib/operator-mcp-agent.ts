import net from 'node:net'

const DEFAULT_SOCKET_PATH = '/run/recruiter-radar-operator/agent.sock'
const MAX_RESPONSE_BYTES = 256 * 1024
const AGENT_TIMEOUT_MS = 6_000

export const OPERATOR_SERVICES = ['web', 'db', 'n8n', 'redis', 'firecrawl'] as const
export const RESTARTABLE_OPERATOR_SERVICES = ['web', 'n8n'] as const

export type OperatorService = (typeof OPERATOR_SERVICES)[number]
export type RestartableOperatorService = (typeof RESTARTABLE_OPERATOR_SERVICES)[number]

type AgentRequest = {
  requestId: string
  action:
    | 'system_health'
    | 'service_state'
    | 'recent_logs'
    | 'resource_usage'
    | 'reverse_proxy_state'
    | 'restart_service'
    | 'reload_proxy'
  args: Record<string, unknown>
}

type AgentResponse = {
  ok: boolean
  result?: unknown
  error?: string
}

export class OperatorAgentError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

export function isOperatorService(value: unknown): value is OperatorService {
  return typeof value === 'string' && OPERATOR_SERVICES.includes(value as OperatorService)
}

export function isRestartableOperatorService(value: unknown): value is RestartableOperatorService {
  return typeof value === 'string' &&
    RESTARTABLE_OPERATOR_SERVICES.includes(value as RestartableOperatorService)
}

export function isOperatorAgentConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const configured = env.RR_OPERATOR_AGENT_SOCKET?.trim()
  return Boolean(configured || env.RR_MCP_RUNTIME === 'operator')
}

export async function callOperatorAgent(
  requestId: string,
  action: AgentRequest['action'],
  args: Record<string, unknown> = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<unknown> {
  const socketPath = env.RR_OPERATOR_AGENT_SOCKET?.trim() || DEFAULT_SOCKET_PATH
  if (!socketPath.startsWith('/run/recruiter-radar-operator/')) {
    throw new OperatorAgentError('agent_socket_not_allowed')
  }

  const payload = JSON.stringify({ requestId, action, args } satisfies AgentRequest)
  if (Buffer.byteLength(payload, 'utf8') > 32 * 1024) {
    throw new OperatorAgentError('agent_request_too_large')
  }

  const response = await exchange(socketPath, `${payload}\n`)
  let parsed: AgentResponse
  try {
    parsed = JSON.parse(response) as AgentResponse
  } catch {
    throw new OperatorAgentError('agent_invalid_response')
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.ok !== 'boolean') {
    throw new OperatorAgentError('agent_invalid_response')
  }
  if (!parsed.ok) {
    throw new OperatorAgentError(
      typeof parsed.error === 'string' && parsed.error ? parsed.error : 'agent_failed',
    )
  }
  return parsed.result ?? null
}

function exchange(socketPath: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath })
    let settled = false
    let bytes = 0
    let response = ''

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(response.trim())
    }

    socket.setTimeout(AGENT_TIMEOUT_MS)
    socket.on('connect', () => socket.end(payload))
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_RESPONSE_BYTES) {
        finish(new OperatorAgentError('agent_response_too_large'))
        return
      }
      response += chunk.toString('utf8')
    })
    socket.on('end', () => finish())
    socket.on('timeout', () => finish(new OperatorAgentError('agent_timeout')))
    socket.on('error', () => finish(new OperatorAgentError('agent_unavailable')))
  })
}
