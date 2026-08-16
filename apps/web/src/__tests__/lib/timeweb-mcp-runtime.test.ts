/** @jest-environment node */

import {
  executeTimewebRuntimeTool,
  listTimewebRuntimeTools,
  parseTimewebRuntimeRequest,
  type TimewebRuntimeExecutor,
} from '@/lib/timeweb-mcp-runtime'

describe('Timeweb MCP runtime allowlist', () => {
  it('publishes every Stage 1 runtime action plus ssh_execute', () => {
    expect(listTimewebRuntimeTools()).toEqual(expect.arrayContaining([
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
      'ssh_execute',
    ]))
  })

  it('accepts only structured allowlisted ssh actions', () => {
    expect(parseTimewebRuntimeRequest('ssh_execute', { action: 'docker_ps' })).toEqual({ action: 'docker_ps' })
    expect(parseTimewebRuntimeRequest('ssh_execute', { action: 'docker_logs', service: 'web' })).toEqual({
      action: 'docker_logs',
      service: 'web',
    })

    for (const action of ['bash', 'sh', 'curl', 'wget', 'rm', 'docker ps; rm -rf /']) {
      expect(parseTimewebRuntimeRequest('ssh_execute', { action })).toBeNull()
    }
    expect(parseTimewebRuntimeRequest('ssh_execute', { action: 'docker_ps', command: 'rm -rf /' })).toBeNull()
    expect(parseTimewebRuntimeRequest('ssh_execute', { command: 'docker ps' })).toBeNull()
    expect(parseTimewebRuntimeRequest('docker_logs', { service: 'arbitrary-container' })).toBeNull()
  })

  it.each([
    ['docker_ps', {}],
    ['docker_logs', { service: 'n8n' }],
    ['git_rev_parse', {}],
  ] as const)('returns structured results for %s', async (name, args) => {
    const executor: TimewebRuntimeExecutor = jest.fn(async (request) => ({
      stdout: JSON.stringify(request),
      stderr: '',
      exit_code: 0,
    }))

    const result = await executeTimewebRuntimeTool(name, args, executor)
    expect(result.action).toBe(name)
    expect(result.exit_code).toBe(0)
    expect(result.stderr).toBe('')
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('never invokes the executor for arbitrary shell input', async () => {
    const executor: TimewebRuntimeExecutor = jest.fn(async () => ({ stdout: '', stderr: '', exit_code: 0 }))
    const result = await executeTimewebRuntimeTool('ssh_execute', { action: 'docker_ps', command: 'bash' }, executor)
    expect(result.exit_code).toBe(403)
    expect(result.stderr).toBe('action_not_allowed')
    expect(executor).not.toHaveBeenCalled()
  })

  it('redacts configured secrets from runtime output', async () => {
    const previous = process.env.RR_TIMEWEB_MCP_TOKEN
    process.env.RR_TIMEWEB_MCP_TOKEN = 'super-secret-timeweb-token'
    try {
      const executor: TimewebRuntimeExecutor = async () => ({
        stdout: 'token=super-secret-timeweb-token',
        stderr: 'super-secret-timeweb-token',
        exit_code: 1,
      })
      const result = await executeTimewebRuntimeTool('docker_ps', {}, executor)
      expect(result.stdout).toBe('token=[REDACTED]')
      expect(result.stderr).toBe('[REDACTED]')
    } finally {
      if (previous === undefined) delete process.env.RR_TIMEWEB_MCP_TOKEN
      else process.env.RR_TIMEWEB_MCP_TOKEN = previous
    }
  })
})
