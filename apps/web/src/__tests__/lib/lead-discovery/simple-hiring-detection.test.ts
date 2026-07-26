describe('Hiring Pattern Detection - Simple Version', () => {
  it('detects multiple vacancies from the same company', () => {
    const vacancies = [
      { id: '1', employer: { id: 'company1', name: 'Tech Corp' }, name: 'Frontend Developer', published_at: '2024-05-28T10:00:00Z' },
      { id: '2', employer: { id: 'company1', name: 'Tech Corp' }, name: 'Backend Developer', published_at: '2024-05-28T11:00:00Z' },
      { id: '3', employer: { id: 'company2', name: 'Data Inc' }, name: 'Data Scientist', published_at: '2024-05-28T12:00:00Z' }
    ]

    // Group by employer
    const companyVacancyCounts = vacancies.reduce<Record<string, number>>((acc, vacancy) => {
      acc[vacancy.employer.id] = (acc[vacancy.employer.id] || 0) + 1
      return acc
    }, {})

    // Find companies with 3+ vacancies
    const companiesWithHiringBurst = Object.entries(companyVacancyCounts)
      .filter(([_, count]) => count >= 3)
      .map(([companyId]) => companyId)

    expect(companiesWithHiringBurst).toHaveLength(0) // No company has 3+ vacancies in this test
  })

  it('identifies diverse role hiring', () => {
    const vacancies = [
      { name: 'Senior Frontend Developer', requirement: 'React, TypeScript' },
      { name: 'Product Manager', requirement: 'Strategy, Analytics' },
      { name: 'HR Business Partner', requirement: 'Recruitment, HR' },
      { name: 'Backend Engineer', requirement: 'Node.js, Python' }
    ]

    // Extract role categories
    const roleCategories = vacancies.map(vacancy => {
      const title = vacancy.name.toLowerCase()
      if (title.includes('frontend') || title.includes('backend') || title.includes('developer')) return 'tech'
      if (title.includes('manager') || title.includes('product')) return 'management'
      if (title.includes('hr') || title.includes('recruitment')) return 'hr'
      return 'other'
    })

    const uniqueCategories = new Set(roleCategories)
    const hasDiverseRoles = uniqueCategories.size >= 3

    expect(hasDiverseRoles).toBe(true)
    expect(uniqueCategories.has('tech')).toBe(true)
    expect(uniqueCategories.has('management')).toBe(true)
    expect(uniqueCategories.has('hr')).toBe(true)
  })

  it('calculates freshness score based on publication date', () => {
    const now = new Date('2024-05-28T15:00:00Z')
    const recentVacancy = {
      published_at: '2024-05-28T14:00:00Z', // 1 hour ago
      name: 'Recent Position'
    }
    const oldVacancy = {
      published_at: '2024-05-27T14:00:00Z', // 25 hours ago
      name: 'Old Position'
    }

    const hoursAgo = (publishedAt: string) => {
      const published = new Date(publishedAt)
      const diffMs = now.getTime() - published.getTime()
      return diffMs / (1000 * 60 * 60)
    }

    const recentFreshness = hoursAgo(recentVacancy.published_at)
    const oldFreshness = hoursAgo(oldVacancy.published_at)

    expect(recentFreshness).toBeLessThan(2) // Less than 2 hours
    expect(oldFreshness).toBeGreaterThan(24) // More than 24 hours
  })

  it('scores companies based on hiring signals', () => {
    const companySignals = {
      company1: {
        vacancyCount: 5,
        roleDiversity: 3, // tech, management, hr
        averageSalary: 250000,
        allRecent: true, // all vacancies published in last 7 days
        hasCareerPage: true
      },
      company2: {
        vacancyCount: 2,
        roleDiversity: 1, // only tech
        averageSalary: 180000,
        allRecent: true,
        hasCareerPage: false
      }
    }

    // Simple scoring algorithm
    const calculateScore = (signals: any) => {
      let score = 0

      // Vacancy count score (max 40 points)
      score += Math.min(signals.vacancyCount * 10, 40)

      // Role diversity score (max 30 points)
      score += signals.roleDiversity * 10

      // Salary score (max 20 points)
      score += Math.min(signals.averageSalary / 10000, 20)

      // Freshness score (max 5 points)
      score += signals.allRecent ? 5 : 0

      // Career page score (max 5 points)
      score += signals.hasCareerPage ? 5 : 0

      return score
    }

    const company1Score = calculateScore(companySignals.company1)
    const company2Score = calculateScore(companySignals.company2)

    expect(company1Score).toBeGreaterThan(company2Score)
    expect(company1Score).toBeGreaterThan(80) // Strong signal
    expect(company2Score).toBeLessThan(60) // Weaker signal
  })
})
