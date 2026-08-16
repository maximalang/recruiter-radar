import { executeTimewebRuntimeAction, listTimewebRuntimeTools } from './timeweb-mcp-runtime'

export type McpRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export function handleTimewebMcpProtocol(request: McpRequest) {
  switch (request.method) {
    case 'initialize':
      return rpcResult(request.id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'recruiter-radar-timeweb', version: '1.0.0' },
      })
    case 'ping':
      return rpcResult(request.id, {})
    case 'tools/list':
      return rpcResult(request.id, {
        tools: listTimewebRuntimeTools().map((name) => ({
          name,
          description: `Timeweb runtime operation ${name}`,
        })),
      })
    case 'tools/call':
      return handleToolCall(request)
    default:
      return rpcError(request.id, -32601, 'method_not_found')
  }
}

function handleToolCall(request: McpRequest) {
  const name = typeof request.params?.name === 'string' ? request.params.name : ''
  return rpcResult(request.id, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        action: name,
        status: 'requires_runtime_executor',
      }),
    }],
  })
}

function rpcResult(id: McpRequest['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: McpRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}
