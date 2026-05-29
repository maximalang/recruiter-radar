/**
 * Source Configuration Management
 *
 * Centralized configuration for lead generation sources,
 * including enable/disable settings, rate limits, and custom mappings.
 */

export interface SourceConfig {
  id: string
  name: string
  enabled: boolean
  priority: number
  rateLimit: {
    requestsPerMinute: number
    burstSize: number
  }
  settings: {
    timeoutMs: number
    retries: number
    customEndpoints?: Record<string, string>
  }
  filters: {
    industries?: string[]
    regions?: string[]
    companySizes?: string[]
    minConfidence?: number
  }
  metadata: {
    description: string
    lastUpdated: Date
    version?: string
  }
}

export interface LeadGenerationProfile {
  id: string
  name: string
  description: string
  sources: string[]
  filters: {
    minScore: number
    industries?: string[]
    regions?: string[]
    companySizes?: string[]
  }
  settings: {
    enableRealTime: boolean
    maxResults: number
    deduplication: {
      enabled: boolean
      strategy: 'exact' | 'fuzzy' | 'cluster'
      threshold: number
    }
    enrichment: {
      enableCareerPages: boolean
      enableBusinessSignals: boolean
      enableRegistryData: boolean
    }
  }
  createdAt: Date
  updatedAt: Date
}

/**
 * Source configuration manager
 */
export class SourceConfigManager {
  private configs = new Map<string, SourceConfig>()
  private profiles = new Map<string, LeadGenerationProfile>()

  constructor() {
    this.initializeDefaultSources()
    this.initializeDefaultProfiles()
  }

  /**
   * Initialize default source configurations
   */
  private initializeDefaultSources() {
    const defaultSources: SourceConfig[] = [
      // Primary Sources
      {
        id: 'hh',
        name: 'HeadHunter',
        enabled: true,
        priority: 1,
        rateLimit: {
          requestsPerMinute: 60,
          burstSize: 10
        },
        settings: {
          timeoutMs: 30000,
          retries: 3,
          customEndpoints: {
            vacancies: '/api/hh/vacancies',
            companies: '/api/hh/companies'
          }
        },
        filters: {
          industries: ['IT', 'Technology', 'Finance'],
            regions: ['moscow', 'spb'],
            minConfidence: 0.7
        },
        metadata: {
          description: 'Primary Russian job board with comprehensive coverage',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },
      {
        id: 'career-pages',
        name: 'Career Pages',
        enabled: true,
        priority: 2,
        rateLimit: {
          requestsPerMinute: 30,
          burstSize: 5
        },
        settings: {
          timeoutMs: 15000,
          retries: 2
        },
        filters: {
          companySizes: ['50-500', '500-1000'],
            minConfidence: 0.8
        },
        metadata: {
          description: 'Direct company career pages for high-quality evidence',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },
      {
        id: 'rabota-rossii',
        name: 'Rabota Rossii',
        enabled: true,
        priority: 3,
        rateLimit: {
          requestsPerMinute: 100,
          burstSize: 20
        },
        settings: {
          timeoutMs: 20000,
          retries: 2
        },
        filters: {
          regions: ['russia'],
            minConfidence: 0.6
        },
        metadata: {
          description: 'Official Russian government job board',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },

      // Secondary Sources
      {
        id: 'linkedin-company-pages',
        name: 'LinkedIn Company Pages',
        enabled: true,
        priority: 4,
        rateLimit: {
          requestsPerMinute: 20,
          burstSize: 3
        },
        settings: {
          timeoutMs: 25000,
          retries: 3,
          customEndpoints: {
            companies: '/api/linkedin/companies'
          }
        },
        filters: {
          industries: ['Technology', 'Finance', 'Professional Services'],
            minConfidence: 0.7
        },
        metadata: {
          description: 'Professional network company pages',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },
      {
        id: 'tech-job-boards',
        name: 'Tech Job Boards',
        enabled: false, // Requires API key
        priority: 5,
        rateLimit: {
          requestsPerMinute: 50,
          burstSize: 10
        },
        settings: {
          timeoutMs: 20000,
          retries: 2
        },
        filters: {
          industries: ['IT', 'Technology'],
            minConfidence: 0.65
        },
        metadata: {
          description: 'Specialized technology job boards',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },
      {
        id: 'superjob',
        name: 'SuperJob',
        enabled: true,
        priority: 6,
        rateLimit: {
          requestsPerMinute: 40,
          burstSize: 8
        },
        settings: {
          timeoutMs: 20000,
          retries: 2
        },
        filters: {
          regions: ['moscow', 'spb', 'novosibirsk'],
            minConfidence: 0.6
        },
        metadata: {
          description: 'Popular Russian job board',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },
      {
        id: 'habr-career',
        name: 'Habr Career',
        enabled: true,
        priority: 7,
        rateLimit: {
          requestsPerMinute: 30,
          burstSize: 5
        },
        settings: {
          timeoutMs: 20000,
          retries: 2
        },
        filters: {
          industries: ['IT', 'Technology'],
            minConfidence: 0.65
        },
        metadata: {
          description: 'IT-focused job board',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },

      // Enrichment Sources
      {
        id: 'egrul-fns',
        name: 'EGRUL/FNS Registry',
        enabled: true,
        priority: 8,
        rateLimit: {
          requestsPerMinute: 100,
          burstSize: 20
        },
        settings: {
          timeoutMs: 15000,
          retries: 1
        },
        filters: {},
        metadata: {
          description: 'Russian company registry data',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },
      {
        id: 'funding-business-signals',
        name: 'Funding Signals',
        enabled: true,
        priority: 9,
        rateLimit: {
          requestsPerMinute: 10,
          burstSize: 2
        },
        settings: {
          timeoutMs: 30000,
          retries: 2
        },
        filters: {
          industries: ['Technology', 'Healthcare', 'Finance'],
            minConfidence: 0.5
        },
        metadata: {
          description: 'Funding and growth signals',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      },
      {
        id: 'company-newsrooms',
        name: 'Company Newsrooms',
        enabled: true,
        priority: 10,
        rateLimit: {
          requestsPerMinute: 20,
          burstSize: 4
        },
        settings: {
          timeoutMs: 25000,
          retries: 2
        },
        filters: {
          companySizes: ['100+', '500+'],
            minConfidence: 0.5
        },
        metadata: {
          description: 'Company news and press releases',
          lastUpdated: new Date(),
          version: '1.0.0'
        }
      }
    ]

    defaultSources.forEach(source => {
      this.configs.set(source.id, source)
    })
  }

  /**
   * Initialize default lead generation profiles
   */
  private initializeDefaultProfiles() {
    const defaultProfiles: LeadGenerationProfile[] = [
      {
        id: 'standard',
        name: 'Standard Lead Generation',
        description: 'Balanced approach using all primary sources',
        sources: ['hh', 'career-pages', 'rabota-rossii'],
        filters: {
          minScore: 1.0,
          industries: [],
          regions: [],
          companySizes: []
        },
        settings: {
          enableRealTime: false,
          maxResults: 100,
          deduplication: {
            enabled: true,
            strategy: 'fuzzy',
            threshold: 0.8
          },
          enrichment: {
            enableCareerPages: true,
            enableBusinessSignals: true,
            enableRegistryData: true
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'premium',
        name: 'Premium Lead Generation',
        description: 'Comprehensive coverage with real-time crawling',
        sources: [
          'hh', 'career-pages', 'rabota-rossii',
          'linkedin-company-pages', 'superjob', 'habr-career',
          'egrul-fns', 'funding-business-signals'
        ],
        filters: {
          minScore: 1.5,
          industries: ['IT', 'Technology', 'Finance'],
          regions: ['moscow', 'spb'],
          companySizes: ['50-500', '500-1000']
        },
        settings: {
          enableRealTime: true,
          maxResults: 200,
          deduplication: {
            enabled: true,
            strategy: 'cluster',
            threshold: 0.9
          },
          enrichment: {
            enableCareerPages: true,
            enableBusinessSignals: true,
            enableRegistryData: true
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'focused',
        name: 'Focused Tech Companies',
        description: 'Specialized for tech industry leads',
        sources: ['hh', 'career-pages', 'tech-job-boards', 'habr-career'],
        filters: {
          minScore: 2.0,
          industries: ['IT', 'Technology'],
          regions: [],
          companySizes: ['50+', '100+']
        },
        settings: {
          enableRealTime: false,
          maxResults: 50,
          deduplication: {
            enabled: true,
            strategy: 'exact',
            threshold: 1.0
          },
          enrichment: {
            enableCareerPages: true,
            enableBusinessSignals: false,
            enableRegistryData: true
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]

    defaultProfiles.forEach(profile => {
      this.profiles.set(profile.id, profile)
    })
  }

  /**
   * Get source configuration
   */
  getSourceConfig(sourceId: string): SourceConfig | undefined {
    return this.configs.get(sourceId)
  }

  /**
   * Update source configuration
   */
  updateSourceConfig(sourceId: string, updates: Partial<SourceConfig>): boolean {
    const config = this.configs.get(sourceId)
    if (!config) return false

    const updated = {
      ...config,
      ...updates,
      metadata: {
        ...config.metadata,
        lastUpdated: new Date()
      }
    }

    this.configs.set(sourceId, updated)
    return true
  }

  /**
   * Get all enabled sources
   */
  getEnabledSources(): SourceConfig[] {
    return Array.from(this.configs.values()).filter(source => source.enabled)
      .sort((a, b) => a.priority - b.priority)
  }

  /**
   * Get lead generation profile
   */
  getProfile(profileId: string): LeadGenerationProfile | undefined {
    return this.profiles.get(profileId)
  }

  /**
   * List all available profiles
   */
  listProfiles(): LeadGenerationProfile[] {
    return Array.from(this.profiles.values())
  }

  /**
   * Create a custom profile
   */
  createProfile(profile: Omit<LeadGenerationProfile, 'id' | 'createdAt' | 'updatedAt'>): string {
    const id = `custom-${Date.now()}`
    const newProfile: LeadGenerationProfile = {
      ...profile,
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    this.profiles.set(id, newProfile)
    return id
  }

  /**
   * Update profile
   */
  updateProfile(profileId: string, updates: Partial<LeadGenerationProfile>): boolean {
    const profile = this.profiles.get(profileId)
    if (!profile) return false

    const updated = {
      ...profile,
      ...updates,
      updatedAt: new Date()
    }

    this.profiles.set(profileId, updated)
    return true
  }

  /**
   * Get recommended sources for a specific industry
   */
  getRecommendedSources(industry: string): SourceConfig[] {
    return this.getEnabledSources().filter(source => {
      if (!source.filters.industries) return true
      return source.filters.industries.includes(industry)
    })
  }

  /**
   * Validate configuration consistency
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check for duplicate priorities
    const priorities = new Map<number, string[]>()
    this.configs.forEach(config => {
      if (!priorities.has(config.priority)) {
        priorities.set(config.priority, [])
      }
      priorities.get(config.priority)!.push(config.id)
    })

    priorities.forEach((sources, priority) => {
      if (sources.length > 1) {
        errors.push(`Multiple sources have priority ${priority}: ${sources.join(', ')}`)
      }
    })

    // Check for circular dependencies in profiles
    // (simplified check for now)
    this.profiles.forEach(profile => {
      profile.sources.forEach(sourceId => {
        if (!this.configs.has(sourceId)) {
          errors.push(`Profile '${profile.name}' references unknown source: ${sourceId}`)
        }
      })
    })

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * Export configuration to JSON
   */
  exportConfig() {
    return {
      sources: Array.from(this.configs.entries()),
      profiles: Array.from(this.profiles.entries()),
      exportedAt: new Date().toISOString()
    }
  }

  /**
   * Import configuration from JSON
   */
  importConfig(config: any) {
    if (config.sources) {
      config.sources.forEach(([id, source]: [string, any]) => {
        this.configs.set(id, source)
      })
    }

    if (config.profiles) {
      config.profiles.forEach(([id, profile]: [string, any]) => {
        this.profiles.set(id, profile)
      })
    }

    return true
  }
}