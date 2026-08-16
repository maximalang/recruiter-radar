import { executeTimewebRuntimeAction } from './timeweb-mcp-runtime-executor'
import { listTimewebMcpTools } from './timeweb-mcp-tools'
import type { TimewebRuntimeAction } from './timeweb-mcp-runtime'

export function getTimewebToolsList() {
  return {
    tools: listTimewebMcpTools(),
  }
}

export async function callTimewebTool(name: string) {
  const action = name as TimewebRuntimeAction

  const result = await executeTimewebRuntimeAction(action)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ],
    isError: result.exitCode !== 0,
  }
}
