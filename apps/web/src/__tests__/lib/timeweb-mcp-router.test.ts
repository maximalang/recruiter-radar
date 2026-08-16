/** @jest-environment node */

import { handleTimewebMcpProtocol } from '@/lib/timeweb-mcp-router'
import type { TimewebRuntimeExecutor } from '@/lib/timeweb-mcp-runtime'

describe('Timeweb MCP protocol router', () => {
  it('routes initialize upstream and advertises local tools capability', async () => {
    const upstream = jest.fn(async () => ({
      jsonrpc: '2.0' as const,
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'timeweb', version: '1' },
      },
    }))

    const response = await handleTimewebMcpProtocol(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { upstream, serverVersion: 'stage1-test' },
    )

    expect(upstream).toHaveBeenCalledTimes(1)
    expect(response?.error).toBeUndefined()
    expect(response?.result).toEqual(expect.objectContaining({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'recruiter-radar-timeweb-mcp', version: 'stage1-test' },
    }))
  })

  it('uses ping as an upstream heartbeat', async () => {
    const upstream = jest.fn(async (request) => ({ jsonrpc: '2.0' as const, id: request.id ?? null, result: {} }))
    const response = await handleTimewebMcpProtocol(
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { upstream },
    )
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ method: 'ping' }))
    expect(response).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
  })

  it('merges official Timeweb tools with local runtime tools', async () => {
    const upstream = jest.fn(async () => ({
      jsonrpc: '2.0' as const,
      id: 3,
      result: { tools: [{ name: 'official_timeweb_tool', inputSchema: { type: 'object' } }] },
    }))
    const response = await handleTimewebMcpProtocol(
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      { upstream },
    )
    const result = response?.result as { tools: Array<{ name: string }> }
    expect(result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'official_timeweb_tool',
      'docker_ps',
      'docker_logs',
      'git_rev_parse',
      'ssh_execute',
    ]))
  })

  it('executes local tools without exposing them to the upstream MCP', async () => {
    const upstream = jest.fn()
    const runtimeExecutor: TimewebRuntimeExecutor = jest.fn(async () => ({
      stdout: 'ok',
      stderr: '',
      exit_code: 0,
    }))
    const response = await handleTimewebMcpProtocol(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'docker_ps', arguments: {} },
      },
      { upstream, runtimeExecutor },
    )
    expect(upstream).not.toHaveBeenCalled()
    expect(runtimeExecutor).toHaveBeenCalledWith({ action: 'docker_ps' })
    expect(response?.result).toEqual(expect.objectContaining({
      structuredContent: { action: 'docker_ps', stdout: 'ok', stderr: '', exit_code: 0 },
      isError: false,
    }))
  })

  it('forwards notifications without creating a JSON-RPC response', async () => {
    const upstream = jest.fn(async () => null)
    const response = await handleTimewebMcpProtocol(
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { upstream },
    )
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(response).toBeNull()
  })
})
