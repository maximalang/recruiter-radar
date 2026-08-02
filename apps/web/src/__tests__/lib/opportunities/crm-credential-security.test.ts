import {
  createCrmCredentialSecret,
  hashCrmCredentialSecret,
  verifyCrmCredentialSecret,
} from '@/lib/opportunities/crm-credential-security'

describe('CRM credential security', () => {
  it('issues a high-entropy secret and a storage-safe descriptor', () => {
    const issued = createCrmCredentialSecret()

    expect(issued.secret).toMatch(/^rrc_[A-Za-z0-9_-]{43}$/)
    expect(issued.secretHash).toMatch(/^[a-f0-9]{64}$/)
    expect(issued.secretPrefix).toHaveLength(8)
    expect(issued.secretHash).toBe(hashCrmCredentialSecret(issued.secret))
    expect(JSON.stringify({
      secretHash: issued.secretHash,
      secretPrefix: issued.secretPrefix,
    })).not.toContain(issued.secret)
  })

  it('verifies hashes without accepting malformed or different secrets', () => {
    const issued = createCrmCredentialSecret()

    expect(verifyCrmCredentialSecret(issued.secret, issued.secretHash)).toBe(true)
    expect(verifyCrmCredentialSecret(`${issued.secret}x`, issued.secretHash)).toBe(false)
    expect(verifyCrmCredentialSecret('', issued.secretHash)).toBe(false)
    expect(verifyCrmCredentialSecret(issued.secret, 'not-a-hash')).toBe(false)
  })
})
