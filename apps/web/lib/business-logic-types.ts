// Business Logic Types for Recruiter Radar

// Company Entity Types
export interface CompanyEntity {
  id: string;
  name: string;
  domain?: string;
  inn?: string;
  ogrn?: string;
  industry?: string;
  size?: 'startup' | 'small' | 'medium' | 'large' | 'enterprise';
  location?: {
    city?: string;
    country?: string;
    region?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// Source Types
export interface DataSource {
  id: string;
  key: string;
  displayName: string;
  type: 'hh' | 'career-pages' | 'company-site' | 'linkedin' | 'tech-job-boards' | 'rabota-rossii';
  isActive: boolean;
  families: string[];
  lastSyncAt?: string;
  config: SourceConfig;
}

export interface SourceConfig {
  targets?: string[];
  filters?: Record<string, unknown>;
  rateLimits?: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  enrichment?: {
    enabled: boolean;
    fields: string[];
  };
}

// Vacancy Types
export interface Vacancy {
  id: string;
  title: string;
  department?: string;
  location?: string;
  salary?: {
    min?: number;
    max?: number;
    currency: string;
    period: 'hour' | 'day' | 'month' | 'year';
  };
  experience?: {
    min?: number;
    max?: number;
    period: 'years' | 'months';
  };
  employmentType: 'full-time' | 'part-time' | 'contract' | 'internship' | 'remote';
  publishedAt: string;
  sourceUrl: string;
  sourceKey: string;
}

// Digest Scoring Types (FIUR Model)
export interface DigestScoringInput {
  company: CompanyEntity;
  vacancies: Vacancy[];
  clientProfile: ClientProfile;
  historicalData?: HistoricalSignal[];
}

export interface HistoricalSignal {
  companyId: string;
  sourceKey: string;
  timestamp: string;
  action: 'contact' | 'skip' | 'later' | 'client' | 'hide-similar';
  confidence: 'A' | 'B' | 'C' | 'D';
}

export interface DigestScoringWeights {
  fit: number;
  intent: number;
  urgency: number;
  reachability: number;
}

export interface DigestScoreResult {
  totalScore: number;
  breakdown: {
    fitScore: number;
    intentScore: number;
    urgencyScore: number;
    reachabilityScore: number;
  };
  confidenceGate: 'A' | 'B' | 'C' | 'D';
  reasons: {
    fit: string[];
    intent: string[];
    urgency: string[];
    reachability: string[];
  };
  evidence: {
    directHiringProof: boolean;
    independentEvidence: number;
    freshSignals: boolean;
    burstPattern: boolean;
    hardToFillRole: boolean;
  };
}

// Client Profile Types
export interface ClientProfile {
  id: string;
  name: string;
  industry?: string;
  icp: ICPProfile;
  dailyDigestLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ICPProfile {
  companySizes: Array<'startup' | 'small' | 'medium' | 'large' | 'enterprise'>;
  industries: string[];
  locations: string[];
  roles: string[];
  technologies?: string[];
  exclusions?: string[];
}

// Dedupe Service Types
export interface DedupeServiceConfig {
  cacheDir?: string;
  cacheTTL?: number;
  suppressionFile?: string;
  metricsFile?: string;
}

export interface SignalIdentity {
  sourceId: string;
  externalId: string;
  primarySourceKey: string;
  lineNumber?: number;
}

export interface EntityIdentity {
  companyName: string;
  companyDomain?: string;
  inn?: string;
  ogrn?: string;
}

export interface DuplicateResult {
  isDuplicate: boolean;
  duplicateOf?: string;
  suppressionId?: string;
  confidence: number;
}

// Source Readiness Types
export interface SourceReadiness {
  sourceKey: string;
  lastCheck: string;
  status: 'ready' | 'needs-setup' | 'failing' | 'disabled';
  metrics: {
    totalRecords: number;
    successfulRuns: number;
    errorRate: number;
    averageResponseTime: number;
  };
  issues: Array<{
    type: 'configuration' | 'connectivity' | 'data-quality' | 'rate-limit';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

// Confidence Gate Types
// The authoritative ConfidenceGate union type ('A'|'B'|'C'|'D') lives in lib/scoring/gates.ts.
// This interface documents the gate *policy* (criteria + delivery action) for reference.
// Import the union type from scoring/gates for actual code; this interface is for
// documentation and configuration only.
export interface ConfidenceGatePolicy {
  gate: import('@/lib/scoring/gates').ConfidenceGate;
  criteria: {
    minEvidenceLayers: number;
    requireDirectHiringProof: boolean;
    allowQuestionableMatch: boolean;
    contextOnlyAllowed: boolean;
  };
  delivery: 'auto' | 'review' | 'suppress';
  description: string;
}

// Quality Metrics Types
export interface QualityMetrics {
  signalCount: number;
  duplicateRate: number;
  falsePositiveRate: number;
  completeness: {
    companyDomain: number;
    companySize: number;
    industry: number;
    location: number;
  };
  freshness: {
    averageAge: number;
    maxAge: number;
    staleSignals: number;
  };
}