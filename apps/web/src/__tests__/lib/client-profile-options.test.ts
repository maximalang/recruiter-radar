/**
 * Guards the shared ICP option dictionaries against drift from the canonical
 * whitelists. clientProfileOptions.ts is client-safe (no `pg` import) so it can
 * no longer run a build-time guard against VALID_* — this server-side test is
 * that guard instead: every option key must be a member of its canonical set,
 * and every contact-policy option must be a valid policy.
 */

import {
  INDUSTRY_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  ROLE_OPTIONS,
  CONTACT_POLICY_OPTIONS,
} from '../../../lib/clientProfileOptions'
import {
  VALID_INDUSTRIES,
  VALID_COMPANY_SIZES,
  VALID_ROLES,
  VALID_CONTACT_POLICIES,
} from '../../../lib/clientProfiles'

describe('clientProfileOptions ⊆ canonical whitelists', () => {
  it('every industry option key is in VALID_INDUSTRIES', () => {
    for (const opt of INDUSTRY_OPTIONS) {
      expect(VALID_INDUSTRIES.has(opt.key)).toBe(true)
    }
  })

  it('every company-size option key is in VALID_COMPANY_SIZES', () => {
    for (const opt of COMPANY_SIZE_OPTIONS) {
      expect(VALID_COMPANY_SIZES.has(opt.key)).toBe(true)
    }
  })

  it('every role option key is in VALID_ROLES', () => {
    for (const opt of ROLE_OPTIONS) {
      expect(VALID_ROLES.has(opt.key)).toBe(true)
    }
  })

  it('every contact-policy option key is a valid policy', () => {
    for (const opt of CONTACT_POLICY_OPTIONS) {
      expect(VALID_CONTACT_POLICIES.has(opt.key)).toBe(true)
    }
  })

  it('labels are non-empty', () => {
    const all = [...INDUSTRY_OPTIONS, ...COMPANY_SIZE_OPTIONS, ...ROLE_OPTIONS, ...CONTACT_POLICY_OPTIONS]
    for (const opt of all) {
      expect(opt.label.trim().length).toBeGreaterThan(0)
    }
  })
})
