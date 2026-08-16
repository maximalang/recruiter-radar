import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { getAllowedRuntimeCommand, type TimewebRuntimeAction } from './timeweb-mcp-runtime'

const execFileAsync = promisify(execFile)

export type RuntimeExecutionResult = {
  action: TimewebRuntimeAction
  stdout: string
  stderr: string
  exitCode: number
}

export async function executeTimewebRuntimeAction(
  action: TimewebRuntimeAction,
): Promise<RuntimeExecutionResult> {
  const runtimeCommand = getAllowedRuntimeCommand(action)
  const [binary, ...args] = runtimeCommand.command.split(' ')

  try {
    const result = await execFileAsync(binary, args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    })

    return {
      action,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number }

    return {
      action,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      exitCode: Number(failure.code ?? 1),
    }
  }
}
