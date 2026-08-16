import { listAllowedRuntimeActions, type TimewebRuntimeAction } from './timeweb-mcp-runtime'

export type TimewebMcpTool = {
  name: TimewebRuntimeAction
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, never>
  }
}

export function listTimewebMcpTools(): TimewebMcpTool[] {
  return listAllowedRuntimeActions().map((action) => ({
    name: action,
    description: `Execute safe Timeweb runtime diagnostic action: ${action}`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  }))
}
