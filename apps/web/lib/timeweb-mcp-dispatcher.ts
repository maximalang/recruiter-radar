import { executeTimewebRuntimeAction } from './timeweb-mcp-runtime-executor'
import { listTimewebMcpTools } from './timeweb-mcp-tools'
import type { TimewebRuntimeAction } from './timeweb-mcp-runtime'

export function getTimewebMcpToolsResponse() {
  return {
    tools: listTimewebMcpTools(),
  }
}

export async function callTimewebMcpTool(name: string) {
  const action = name as TimewebRuntimeAction

  const allowed = listTimewebMcpTools().some((tool) => tool.name === action)

  if (!allowed) {
    return {
      error: 'unknown_tool',
      exitCode: 1,
    }
  }

  return executeTimewebRuntimeAction(action)
}
