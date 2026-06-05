/**
 * Tests for contact path filtering based on contact policy.
 *
 * Per product concept §Lawful contact path:
 * - corporate_only: only corporate/HR/career-page/form channels
 * - no_personal: exclude personal-email, phone, telegram, whatsapp
 * - unrestricted: all paths allowed
 */

import { filterContactPathsByPolicy } from '@/lib/contact-policy-filter'
import type { ContactPathLike } from '@/lib/contact-policy-filter'

describe('filterContactPathsByPolicy', () => {
  const allPaths: ContactPathLike[] = [
    { category: 'careers-email', value: 'careers@corp.com' },
    { category: 'hr-email', value: 'hr@corp.com' },
    { category: 'generic-email', value: 'info@corp.com' },
    { category: 'contact-form', value: 'https://corp.com/contact' },
    { category: 'personal-email', value: 'john@corp.com' },
    { category: 'phone', value: '+7-900-123-4567' },
    { category: 'telegram', value: '@john' },
    { category: 'whatsapp', value: '+7-900-123-4567' },
  ]

  it('corporate_only: keeps only corporate/HR/form channels', () => {
    const result = filterContactPathsByPolicy(allPaths, 'corporate_only')
    const categories = result.map(p => p.category)
    expect(categories).toEqual(['careers-email', 'hr-email', 'generic-email', 'contact-form'])
    expect(categories).not.toContain('personal-email')
    expect(categories).not.toContain('phone')
  })

  it('no_personal: excludes personal-email, phone, telegram, whatsapp', () => {
    const result = filterContactPathsByPolicy(allPaths, 'no_personal')
    const categories = result.map(p => p.category)
    expect(categories).toContain('careers-email')
    expect(categories).toContain('hr-email')
    expect(categories).not.toContain('personal-email')
    expect(categories).not.toContain('phone')
    expect(categories).not.toContain('telegram')
    expect(categories).not.toContain('whatsapp')
  })

  it('unrestricted: keeps all paths', () => {
    const result = filterContactPathsByPolicy(allPaths, 'unrestricted')
    expect(result).toHaveLength(8)
  })

  it('empty input returns empty', () => {
    expect(filterContactPathsByPolicy([], 'corporate_only')).toEqual([])
  })
})
