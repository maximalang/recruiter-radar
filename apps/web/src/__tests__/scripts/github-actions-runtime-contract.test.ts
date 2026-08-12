import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ACTION_MAJORS = {
  'actions/checkout': 7,
  'actions/setup-node': 7,
  'actions/upload-artifact': 7,
  'actions/download-artifact': 8,
} as const

describe('GitHub Actions runtime contract', () => {
  const workflowsDirectory = path.resolve(process.cwd(), '../../.github/workflows')
  const workflows = readdirSync(workflowsDirectory)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => ({
      file,
      source: readFileSync(path.join(workflowsDirectory, file), 'utf8'),
    }))

  it('uses the supported Node 24 action majors everywhere', () => {
    for (const { file, source } of workflows) {
      for (const [action, major] of Object.entries(ACTION_MAJORS)) {
        const usages = source.matchAll(new RegExp(`${action.replace('/', '\\/')}@v(\\d+)`, 'g'))
        for (const usage of usages) {
          expect({ file, action, major: Number(usage[1]) }).toEqual({ file, action, major })
        }
      }
    }
  })

  it('keeps the application CI runtime on Node 22', () => {
    const setupNodeWorkflows = workflows.filter(({ source }) => source.includes('actions/setup-node@'))
    expect(setupNodeWorkflows.length).toBeGreaterThan(0)
    for (const { file, source } of setupNodeWorkflows) {
      const versions = [...source.matchAll(/node-version:\s*['"]?(\d+)['"]?/g)]
      expect({ file, versions: versions.map((match) => match[1]) }).toEqual({
        file,
        versions: expect.arrayContaining(['22']),
      })
      expect(versions.every((match) => match[1] === '22')).toBe(true)
    }
  })
})
