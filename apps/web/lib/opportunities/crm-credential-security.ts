import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const SECRET_PATTERN = /^rrc_[A-Za-z0-9_-]{43}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

export interface IssuedCrmCredentialSecret {
  secret: string
  secretHash: string
  secretPrefix: string
}

export function createCrmCredentialSecret(): IssuedCrmCredentialSecret {
  const random = randomBytes(32).toString('base64url')
  const secret = `rrc_${random}`
  return {
    secret,
    secretHash: hashCrmCredentialSecret(secret),
    secretPrefix: random.slice(0, 8),
  }
}

export function hashCrmCredentialSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function verifyCrmCredentialSecret(
  candidate: string,
  expectedHash: string,
): boolean {
  if (!SECRET_PATTERN.test(candidate) || !HASH_PATTERN.test(expectedHash)) {
    return false
  }
  const candidateBytes = Buffer.from(hashCrmCredentialSecret(candidate), 'hex')
  const expectedBytes = Buffer.from(expectedHash, 'hex')
  return candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
}
