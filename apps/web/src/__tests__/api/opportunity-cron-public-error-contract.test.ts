import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const route = fs.readFileSync(
  path.join(root, 'apps/web/app/api/cron/opportunities/[job]/route.ts'),
  'utf8',
)

describe('opportunity cron public error contract', () => {
  it('does not disclose the cron credential name when the service is unconfigured', () => {
    expect(route).toContain("error: 'Opportunity service is not configured.'")
    expect(route).not.toContain("error: 'CRON_API_KEY is not configured.'")
  })

  it('keeps unexpected job failures generic', () => {
    expect(route).toContain("error: 'Opportunity job failed.'")
  })
})
