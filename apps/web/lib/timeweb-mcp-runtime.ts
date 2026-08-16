import { execFile } from 'node:child_process'

export type TimewebRuntimeAction =
  | 'docker_ps'
  | 'docker_compose_ps'
  | 'docker_logs'
  | 'docker_health'
  | 'system_info'
  | 'disk_usage'
  | 'memory_usage'
  | 'process_list'
  | 'git_rev_parse'
  | 'git_status'
  | 'deployment_info'

export type TimewebRuntimeService = 'web' | 'postgres' | 'redis' | 'n8n'

export type TimewebRuntimeRequest = {
  action: TimewebRuntimeAction
  service?: TimewebRuntimeService
}

export type TimewebRuntimeResult = {
  action: TimewebRuntimeAction
  stdout: string
  stderr: string
  exit_code: number
}

export type TimewebRuntimeExecutor = (request: TimewebRuntimeRequest) => Promise<Omit<TimewebRuntimeResult, 'action'>>

const ACTIONS = new Set<TimewebRuntimeAction>([
  'docker_ps',
  'docker_compose_ps',
  'docker_logs',
  'docker_health',
  'system_info',
  'disk_usage',
  'memory_usage',
  'process_list',
  'git_rev_parse',
  'git_status',
  'deployment_info',
])

const SERVICES = new Set<TimewebRuntimeService>(['web', 'postgres', 'redis', 'n8n'])

export const TIMEWEB_RUNTIME_TOOL_DEFINITIONS = [
  tool('docker_ps', 'List running Docker containers on recruiter-radar-prod.'),
  tool('docker_compose_ps', 'Show Docker Compose service state for Recruiter Radar production.'),
  {
    name: 'docker_logs',
    description: 'Read the last 200 log lines for an allowlisted production service.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string', enum: [...SERVICES] } },
      additionalProperties: false,
    },
  },
  tool('docker_health', 'Return health and image metadata for core production containers.'),
  tool('system_info', 'Return production host OS and kernel information.'),
  tool('disk_usage', 'Return production disk usage.'),
  tool('memory_usage', 'Return production memory usage.'),
  tool('process_list', 'Return the production process list.'),
  tool('git_rev_parse', 'Return the repository HEAD visible on the production host.'),
  tool('git_status', 'Return the repository status visible on the production host.'),
  tool('deployment_info', 'Return container, image, deployment revision and health mapping.'),
  {
    name: 'ssh_execute',
    description: 'Execute one allowlisted production runtime action over a forced-command SSH boundary. Arbitrary commands are never accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        service: { type: 'string', enum: [...SERVICES] },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
] as const

function tool(name: TimewebRuntimeAction, description: string) {
  return { name, description, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
}

export function listTimewebRuntimeTools(): string[] {
  return [...ACTIONS, 'ssh_execute']
}

export function isTimewebRuntimeTool(name: string): boolean {
  return name === 'ssh_execute' || ACTIONS.has(name as TimewebRuntimeAction)
}

export function parseTimewebRuntimeRequest(name: string, args: unknown): TimewebRuntimeRequest | null {
  const input = isRecord(args) ? args : {}
  const action = name === 'ssh_execute' ? input.action : name
  if (typeof action !== 'string' || !ACTIONS.has(action as TimewebRuntimeAction)) return null

  const keys = Object.keys(input)
  const allowedKeys = name === 'ssh_execute' ? new Set(['action', 'service']) : new Set(['service'])
  if (keys.some((key) => !allowedKeys.has(key))) return null

  const service = input.service
  if (service !== undefined && (typeof service !== 'string' || !SERVICES.has(service as TimewebRuntimeService))) return null
  if (action !== 'docker_logs' && service !== undefined) return null

  return {
    action: action as TimewebRuntimeAction,
    ...(service ? { service: service as TimewebRuntimeService } : {}),
  }
}

export async function executeTimewebRuntimeTool(
  name: string,
  args: unknown,
  executor: TimewebRuntimeExecutor = executeViaRestrictedSsh,
): Promise<TimewebRuntimeResult> {
  const request = parseTimewebRuntimeRequest(name, args)
  if (!request) {
    return { action: safeAction(name), stdout: '', stderr: 'action_not_allowed', exit_code: 403 }
  }

  const result = await executor(request)
  return {
    action: request.action,
    stdout: redactRuntimeOutput(result.stdout),
    stderr: redactRuntimeOutput(result.stderr),
    exit_code: result.exit_code,
  }
}

export async function executeTimewebRuntimeAction(
  request: TimewebRuntimeRequest,
  executor: TimewebRuntimeExecutor = executeViaRestrictedSsh,
): Promise<TimewebRuntimeResult> {
  return executeTimewebRuntimeTool(request.action, request.service ? { service: request.service } : {}, executor)
}

async function executeViaRestrictedSsh(request: TimewebRuntimeRequest): Promise<Omit<TimewebRuntimeResult, 'action'>> {
  if (process.env.RR_TIMEWEB_RUNTIME_SSH_ENABLED !== 'true') {
    return { stdout: '', stderr: 'runtime_ssh_disabled', exit_code: 503 }
  }

  const host = requiredEnv('RR_TIMEWEB_RUNTIME_SSH_HOST')
  const user = requiredEnv('RR_TIMEWEB_RUNTIME_SSH_USER')
  const keyFile = requiredEnv('RR_TIMEWEB_RUNTIME_SSH_KEY_FILE')
  const knownHosts = requiredEnv('RR_TIMEWEB_RUNTIME_SSH_KNOWN_HOSTS_FILE')
  const port = parsePort(process.env.RR_TIMEWEB_RUNTIME_SSH_PORT)
  const remoteAction = request.action === 'docker_logs'
    ? `docker_logs:${request.service ?? 'web'}`
    : request.action

  return new Promise((resolve) => {
    execFile('/usr/bin/ssh', [
      '-T',
      '-p', String(port),
      '-i', keyFile,
      '-o', 'BatchMode=yes',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${knownHosts}`,
      '-o', 'ConnectTimeout=5',
      `${user}@${host}`,
      remoteAction,
    ], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const code = (error as (Error & { code?: number | string }) | null)?.code
      const exitCode = typeof code === 'number' ? code : error ? 1 : 0
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exit_code: exitCode })
    })
  })
}

function redactRuntimeOutput(value: string): string {
  let output = String(value ?? '')
  const secrets = [process.env.RR_TIMEWEB_MCP_TOKEN, process.env.DATABASE_URL, process.env.REDIS_URL]
  for (const secret of secrets) {
    const candidate = secret?.trim()
    if (candidate && candidate.length >= 8) output = output.split(candidate).join('[REDACTED]')
  }
  return output
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '22')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RR_TIMEWEB_RUNTIME_SSH_PORT is invalid')
  return port
}

function safeAction(name: string): TimewebRuntimeAction {
  return ACTIONS.has(name as TimewebRuntimeAction) ? name as TimewebRuntimeAction : 'system_info'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
