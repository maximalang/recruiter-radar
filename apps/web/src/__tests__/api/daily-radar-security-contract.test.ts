import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Daily Radar security contract', () => {
  test('does not expose the cron credential name in public route errors', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'app/api/cron/daily-radar/route.ts'),
      'utf8',
    )

    expect(route).toContain("const apiKey = process.env.CRON_API_KEY")
    expect(route).toContain("error: 'Daily Radar service is not configured.'")
    expect(route).not.toContain("error: 'CRON_API_KEY is not configured.'")
  })
})
