import {
  createCrmWebhookSignature,
  resolvePublicWebhookDestination,
  verifyCrmWebhookSignature,
} from '@/lib/opportunities/crm-webhook'

describe('CRM webhook security', () => {
  it('signs the timestamp, event id and exact raw body', () => {
    const input = {
      credentialSecretHash: 'a'.repeat(64),
      timestamp: '1785590000',
      eventId: '0a86f77c-e41f-5d5a-a16e-b440391d2e0d',
      body: '{"eventType":"opportunity.upserted"}',
    }
    const signature = createCrmWebhookSignature(input)

    expect(signature).toMatch(/^v1=[a-f0-9]{64}$/)
    expect(verifyCrmWebhookSignature({ ...input, signature })).toBe(true)
    expect(verifyCrmWebhookSignature({
      ...input,
      body: `${input.body} `,
      signature,
    })).toBe(false)
  })

  it('pins delivery to a public address only when every DNS result is public', async () => {
    const destination = await resolvePublicWebhookDestination(
      'https://hooks.example.test/opportunity',
      async () => [
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ],
    )

    expect(destination.url.hostname).toBe('hooks.example.test')
    expect(destination.address).toBe('93.184.216.34')
    expect(destination.family).toBe(4)
  })

  it.each([
    ['https://127.0.0.1/hook', [{ address: '127.0.0.1', family: 4 }]],
    ['https://hooks.example.test/hook', [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]],
    ['https://[::1]/hook', [{ address: '::1', family: 6 }]],
  ])('rejects private or mixed DNS destinations: %s', async (url, addresses) => {
    await expect(resolvePublicWebhookDestination(
      url,
      async () => addresses as never,
    )).rejects.toThrow('crm_webhook_destination_unsafe')
  })
})
