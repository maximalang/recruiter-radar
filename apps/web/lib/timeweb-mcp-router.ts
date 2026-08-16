import {
  TIMEWEB_RUNTIME_TOOL_DEFINITIONS,
  executeTimewebRuntimeTool,
  isTimewebRuntimeTool,
  type TimewebRuntimeExecutor,
} from './timeweb-mcp-runtime'

export type JsonRpcId = string | number | null
export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type TimewebMcpUpstreamCall = (request: JsonRpcRequest) => Promise<JsonRpcResponse | null>

export type TimewebMcpRouterContext = {
  upstream: TimewebMcpUpstreamCall
  runtimeExecutor?: TimewebRuntimeExecutor
  serverVersion?: string
}

export async function handleTimewebMcpProtocol(
  request: JsonRpcRequest,
  context: TimewebMcpRouterContext,
): Promise<JsonRpcResponse | null> {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return rpcError(request?.id ?? null, -32600, 'Invalid Request')
  }

  if (request.method === 'initialize') {
    const upstream = await context.upstream(request)
    if (upstream?.error) return upstream
    const upstreamResult = isRecord(upstream?.result) ? upstream.result : {}
    const capabilities = isRecord(upstreamResult.capabilities) ? upstreamResult.capabilities : {}
    return rpcResult(request.id ?? null, {
      ...upstreamResult,
      protocolVersion: typeof upstreamResult.protocolVersion === 'string' ? upstreamResult.protocolVersion : '2025-03-26',
      capabilities: {
        ...capabilities,
        tools: isRecord(capabilities.tools) ? capabilities.tools : {},
      },
      serverInfo: {
        name: 'recruiter-radar-timeweb-mcp',
        version: context.serverVersion ?? process.env.RR_DEPLOY_SHA ?? 'unknown',
      },
    })
  }

  if (request.method === 'ping') {
    const upstream = await context.upstream(request)
    if (upstream?.error) return upstream
    return rpcResult(request.id ?? null, {})
  }

  if (request.method === 'tools/list') {
    const upstream = await context.upstream(request)
    if (upstream?.error) return upstream
    const result = isRecord(upstream?.result) ? upstream.result : {}
    const upstreamTools = Array.isArray(result.tools) ? result.tools : []
    const localNames = new Set(TIMEWEB_RUNTIME_TOOL_DEFINITIONS.map((item) => item.name))
    const merged = upstreamTools.filter((item) => !isRecord(item) || typeof item.name !== 'string' || !localNames.has(item.name))
    return rpcResult(request.id ?? null, { ...result, tools: [...merged, ...TIMEWEB_RUNTIME_TOOL_DEFINITIONS] })
  }

  if (request.method === 'tools/call') {
    const params = isRecord(request.params) ? request.params : {}
    const name = typeof params.name === 'string' ? params.name : ''
    if (isTimewebRuntimeTool(name)) {
      const runtime = await executeTimewebRuntimeTool(name, params.arguments, context.runtimeExecutor)
      return rpcResult(request.id ?? null, {
        content: [{ type: 'text', text: JSON.stringify(runtime) }],
        structuredContent: runtime,
        isError: runtime.exit_code !== 0,
      })
    }
    return context.upstream(request)
  }

  if (request.method.startsWith('notifications/')) {
    await context.upstream(request)
    return null
  }

  return context.upstream(request)
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return isRecord(value)
    && value.jsonrpc === '2.0'
    && typeof value.method === 'string'
    && (value.id === undefined || value.id === null || typeof value.id === 'string' || typeof value.id === 'number')
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
