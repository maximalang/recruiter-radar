import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workflow = readFileSync(
  resolve(process.cwd(), '..', '..', '.github', 'workflows', 'deploy.yml'),
  'utf8',
)

describe('production deploy workflow contract', () => {
  it('deploys main only after the Tests workflow succeeds', () => {
    expect(workflow).toContain('workflow_run:')
    expect(workflow).toContain('workflows: [Tests]')
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(workflow).toContain("github.event.workflow_run.event == 'push'")
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'")
  })

  it('checks out and tags the exact tested commit', () => {
    expect(workflow).toContain('github.event.workflow_run.head_sha')
    expect(workflow).toContain('recruiter-radar:${DEPLOY_SHA}')
    expect(workflow).not.toContain('docker build -f apps/web/Dockerfile -t recruiter-radar:latest')
    expect(workflow).toContain('--build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID=')
    expect(workflow).toContain('--build-arg NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT=')
  })

  it('keeps a rollback image and never deletes all unused images', () => {
    expect(workflow).toContain('recruiter-radar:rollback')
    expect(workflow).toContain('Rollback production deployment')
    expect(workflow).not.toContain('docker image prune -af')
  })

  it('uses stable server-rendered deploy markers rather than mutable landing copy', () => {
    expect(workflow).toContain('data-deploy-anchor="recruiter-radar-landing-v3"')
    expect(workflow).toContain('data-brand-header="recruiter-radar-v3"')
    expect(workflow).not.toContain('Каждый день Recruiter Radar находит лучшие компании')
    expect(workflow).not.toContain("grep -q 'data-mark=\"false\"'")
  })
})
