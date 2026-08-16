import { callTimewebTool, getTimewebToolsList } from './timeweb-mcp-runtime-handler'

export type McpRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export function isRuntimeToolRequest(request: McpRequest): boolean {
  return request.method === 'tools/list' || request.method === 'tools/call'
}

export function handleTimewebMcpProtocol(request: McpRequest) {
  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: request.id ?? null,
      result: getTimewebToolsList(),
    }
  }

  if (request.method === 'tools/call') {
    const name = String(request.params?.name ?? '')

    return callTimewebTool(name).then((result) => ({
      jsonrpc: '2.0',
      id: request.id ?? null,
      result,
    }))
  }

  return null
}
