import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const templateRoot = resolve(
  process.cwd(),
  '..',
  '..',
  'docs',
  'integrations',
  'templates',
)

describe('Opportunity CRM templates', () => {
  const amo = read('amocrm-opportunity.json')
  const bitrix = read('bitrix24-opportunity.json')
  const n8n = read('n8n-opportunity-outcome-subworkflow.json')

  it('ships provider mappings around the public opportunity identity', () => {
    expect(amo.provider).toBe('amocrm')
    expect(amo.operation.path).toBe('/api/v4/leads')
    expect(JSON.stringify(amo)).toContain('{{opportunity.opportunityReference}}')
    expect(bitrix.provider).toBe('bitrix24')
    expect(bitrix.operation.method).toBe('crm.item.add')
    expect(bitrix.operation.entityTypeId).toBe(2)
    expect(JSON.stringify(bitrix)).toContain('{{opportunity.opportunityReference}}')
  })

  it('keeps the n8n workflow inactive and free of a public trigger or credentials', () => {
    expect(n8n.active).toBe(false)
    expect(n8n.nodes[0]?.type).toBe('n8n-nodes-base.executeWorkflowTrigger')
    expect(n8n.nodes.some((node: { type: string }) =>
      node.type === 'n8n-nodes-base.webhook')).toBe(false)
    expect(n8n.meta.templateCredsSetupCompleted).toBe(false)
  })

  it('contains no tenant IDs, personal-contact fields or embedded secrets', () => {
    for (const template of [amo, bitrix, n8n]) {
      const serialized = JSON.stringify(template)
      expect(serialized).not.toMatch(/"(?:ownerId|workspaceId|contactReference)"/)
      expect(serialized).not.toMatch(/rrc_[A-Za-z0-9_-]{43}/)
      expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/i)
      expect(serialized).not.toMatch(/\/rest\/\d+\/[A-Za-z0-9_-]{12,}\//)
    }
  })
})

function read(name: string) {
  return JSON.parse(readFileSync(resolve(templateRoot, name), 'utf8'))
}
