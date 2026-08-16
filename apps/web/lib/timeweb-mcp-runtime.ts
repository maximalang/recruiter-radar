export type TimewebRuntimeResult = {
  stdout: string
  stderr: string
  exit_code: number
  action: string
}

const ACTIONS: Record<string, string> = {
  docker_ps: 'docker ps --format json',
  docker_compose_ps: 'docker compose ps --format json',
  git_rev_parse: 'git rev-parse HEAD',
  disk_usage: 'df -h',
  memory_usage: 'free -m',
  process_list: 'ps aux',
}

export function listTimewebRuntimeTools() {
  return Object.keys(ACTIONS)
}

export async function executeTimewebRuntimeAction(
  action: string,
  executor: (command: string) => Promise<{ stdout: string; stderr: string; exit_code: number }>,
): Promise<TimewebRuntimeResult> {
  const command = ACTIONS[action]
  if (!command) {
    return { action, stdout: '', stderr: 'action_not_allowed', exit_code: 403 }
  }

  const result = await executor(command)
  return { action, ...result }
}
