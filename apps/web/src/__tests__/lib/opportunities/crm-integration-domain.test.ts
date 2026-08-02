import {
  CRM_INBOUND_EVENT_TYPES,
  CrmIntegrationValidationError,
  normalizeCrmIntegrationInput,
} from '@/lib/opportunities/crm-integration-domain'

describe('CRM integration input', () => {
  it('normalizes a tenant integration and its credential policy', () => {
    expect(normalizeCrmIntegrationInput({
      provider: 'n8n',
      displayName: '  Revenue workflow  ',
      outboundWebhookUrl: 'https://hooks.example.test/opportunity',
      allowedEventTypes: ['won', 'contacted', 'won'],
      rateLimitPolicy: { maxRequests: 20, windowSeconds: 60 },
      replayWindowSeconds: 180,
    })).toEqual({
      provider: 'n8n',
      displayName: 'Revenue workflow',
      outboundWebhookUrl: 'https://hooks.example.test/opportunity',
      allowedEventTypes: ['contacted', 'won'],
      rateLimitMaxRequests: 20,
      rateLimitWindowSeconds: 60,
      replayWindowSeconds: 180,
    })
  })

  it('rejects destinations that can disclose credentials or bypass HTTPS', () => {
    for (const outboundWebhookUrl of [
      'http://hooks.example.test/path',
      'https://user:password@hooks.example.test/path',
      'https://hooks.example.test/path#secret',
      'https://localhost/path',
    ]) {
      expect(() => normalizeCrmIntegrationInput({
        provider: 'generic',
        displayName: 'Outbound',
        outboundWebhookUrl,
        allowedEventTypes: ['won'],
      })).toThrow(CrmIntegrationValidationError)
    }
  })

  it('rejects unknown providers, events and unsafe policy values', () => {
    expect(() => normalizeCrmIntegrationInput({
      provider: 'unknown',
      displayName: 'CRM',
      allowedEventTypes: ['won'],
    })).toThrow('crm_provider_invalid')
    expect(() => normalizeCrmIntegrationInput({
      provider: 'generic',
      displayName: 'CRM',
      allowedEventTypes: [...CRM_INBOUND_EVENT_TYPES, 'invented'],
    })).toThrow('crm_allowed_event_types_invalid')
    expect(() => normalizeCrmIntegrationInput({
      provider: 'generic',
      displayName: 'CRM',
      allowedEventTypes: ['won'],
      rateLimitPolicy: { maxRequests: 0, windowSeconds: 60 },
    })).toThrow('crm_rate_limit_policy_invalid')
  })
})
