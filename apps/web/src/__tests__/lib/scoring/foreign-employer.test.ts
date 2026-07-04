import {
  detectForeignEmployer,
  applyForeignEmployerPenalty,
  FOREIGN_EMPLOYER_SCORE_PENALTY,
} from '@/lib/scoring/foreign-employer'

describe('detectForeignEmployer', () => {
  it('flags a foreign-ATS host with no RU footprint', () => {
    const result = detectForeignEmployer({
      sourceDisplayName: 'Discord',
      sourceExternalId: 'domain:boards.greenhouse.io',
      candidateSourceKeys: ['domain:boards.greenhouse.io', 'org:discord'],
      evidenceTitles: ['Senior Backend Engineer'],
      locationNames: ['San Francisco'],
    })
    expect(result.isForeign).toBe(true)
    expect(result.matchedDomain).toBe('greenhouse.io')
  })

  it('does not flag a domestic (HH/rabota-rossii) lead', () => {
    const result = detectForeignEmployer({
      sourceDisplayName: 'Сбербанк',
      sourceExternalId: 'org:3529',
      candidateSourceKeys: ['org:3529', 'company-name:сбербанк'],
      evidenceTitles: ['Backend разработчик'],
      locationNames: ['Москва'],
    })
    expect(result.isForeign).toBe(false)
    expect(result.matchedDomain).toBeNull()
  })

  it('exempts a RU company hosted on a foreign ATS (Cyrillic footprint)', () => {
    const result = detectForeignEmployer({
      sourceDisplayName: 'Яндекс',
      sourceExternalId: 'domain:jobs.lever.co',
      candidateSourceKeys: ['domain:jobs.lever.co'],
      evidenceTitles: ['Разработчик'],
      locationNames: ['Москва'],
    })
    expect(result.isForeign).toBe(false)
    expect(result.matchedDomain).toBe('lever.co')
  })

  it('exempts a foreign-ATS host with an explicit RU city (Latin)', () => {
    const result = detectForeignEmployer({
      sourceDisplayName: 'SomeCo',
      sourceExternalId: 'domain:jobs.workday.com',
      candidateSourceKeys: ['domain:jobs.workday.com'],
      evidenceTitles: ['Engineer'],
      locationNames: ['Moscow, Russia'],
    })
    expect(result.isForeign).toBe(false)
  })

  it('exempts a foreign-ATS host that also carries a .ru domain key', () => {
    const result = detectForeignEmployer({
      sourceDisplayName: 'SomeCo',
      sourceExternalId: 'domain:boards.greenhouse.io',
      candidateSourceKeys: ['domain:boards.greenhouse.io', 'domain:someco.ru'],
      locationNames: ['Remote'],
    })
    expect(result.isForeign).toBe(false)
  })

  // Regression (prod run 36): Discord/D&B ranked ABOVE domestic leads because the
  // ATS host lived ONLY in orgs.career_page_url — the source keys carried a clean
  // domain (domain:discord.com) that never matched FOREIGN_ATS_DOMAINS. The digest
  // mapper now folds career_page_url into candidateSourceKeys as a raw URL, so the
  // detector must match an ATS host from a full https:// URL, not just a
  // domain:-prefixed key.
  it('flags a foreign ATS host passed as a raw career-page URL (clean domain in keys)', () => {
    const result = detectForeignEmployer({
      sourceDisplayName: 'Discord',
      sourceExternalId: '',
      // The real prod shape: clean company domain in the keys, ATS host only in
      // the appended career_page_url.
      candidateSourceKeys: ['domain:discord.com', 'https://boards.greenhouse.io/discord'],
      evidenceTitles: ['Senior Backend Engineer', 'Product Designer, Ads'],
      locationNames: ['San Francisco Bay Area', 'Remote (U.S.)'],
    })
    expect(result.isForeign).toBe(true)
    expect(result.matchedDomain).toBe('greenhouse.io')
  })

  it('flags a Lever raw career-page URL with foreign locations (D&B shape)', () => {
    const result = detectForeignEmployer({
      sourceDisplayName: 'Dun & Bradstreet',
      sourceExternalId: '',
      candidateSourceKeys: ['domain:dnb.com', 'https://jobs.lever.co/dnb'],
      evidenceTitles: ['AI Architect', 'Account Executive II'],
      locationNames: ['Austin - Texas - United States', 'Dublin - Ireland'],
    })
    expect(result.isForeign).toBe(true)
    expect(result.matchedDomain).toBe('lever.co')
  })
})

describe('applyForeignEmployerPenalty', () => {
  it('subtracts the penalty for a foreign lead and never goes below 0', () => {
    expect(applyForeignEmployerPenalty(300, true)).toBe(300 - FOREIGN_EMPLOYER_SCORE_PENALTY)
    expect(applyForeignEmployerPenalty(50, true)).toBe(0)
  })

  it('leaves a domestic lead unchanged', () => {
    expect(applyForeignEmployerPenalty(300, false)).toBe(300)
  })

  it('sinks a foreign direct-proof (300) below a domestic platform lead (200)', () => {
    const foreign = applyForeignEmployerPenalty(300, true)
    const domestic = applyForeignEmployerPenalty(200, false)
    expect(foreign).toBeLessThan(domestic)
  })
})
