export type TimewebRuntimeAction =
  | 'docker_ps'
  | 'docker_compose_ps'
  | 'docker_logs'
  | 'git_rev_parse'
  | 'disk_usage'
  | 'memory_usage'
  | 'process_list'

export type RuntimeCommand = {
  action: TimewebRuntimeAction
  command: string
}

const COMMANDS: Record<TimewebRuntimeAction, string> = {
  docker_ps: 'docker ps',
  docker_compose_ps: 'docker compose ps',
  docker_logs: 'docker logs --tail 200',
  git_rev_parse: 'git rev-parse HEAD',
  disk_usage: 'df -h',
  memory_usage: 'free -m',
  process_list: 'ps aux',
}

export function getAllowedRuntimeCommand(action: TimewebRuntimeAction): RuntimeCommand {
  const command = COMMANDS[action]

  if (!command) {
    throw new Error('runtime_action_not_allowed')
  }

  return {
    action,
    command,
  }
}

export function listAllowedRuntimeActions(): TimewebRuntimeAction[] {
  return Object.keys(COMMANDS) as TimewebRuntimeAction[]
}
