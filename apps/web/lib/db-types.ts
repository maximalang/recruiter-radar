// Database Types for Recruiter Radar
// Based on schema in packages/db/schema/init.sql

// Database Enums
export enum SubscriptionStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  EXPIRED = 'expired'
}

export enum LeadState {
  NEW = 'new',
  SAVED = 'saved',
  CONTACTED = 'contacted',
  REPLIED = 'replied',
  WON = 'won',
  BADFIT = 'badfit',
  SNOOZE = 'snooze',
  DISMISSED = 'dismissed'
}

export enum SignalKind {
  JOB_POSTING = 'job_posting',
  TEAM_GROWTH = 'team_growth',
  FUNDING = 'funding',
  LEADERSHIP_CHANGE = 'leadership_change',
  OTHER = 'other'
}

export enum DeliveryStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed'
}

export enum DigestRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum DigestFeedbackStatus {
  NONE = 'none',
  CONTACTED = 'contacted',
  REPLIED = 'replied',
  WON = 'won',
  BADFIT = 'badfit',
  SNOOZE = 'snooze',
  DISMISSED = 'dismissed'
}

// Database Tables Types
export interface User {
  id: number;
  email: string;
  full_name?: string;
  telegram_chat_id?: number;
  telegram_username?: string;
  created_at: string;
  updated_at: string;
}

export interface Org {
  id: number;
  name: string;
  domain?: string;
  website_url?: string;
  created_at: string;
  updated_at: string;
}

export interface OrgSourceRef {
  id: number;
  org_id: number;
  source: string;
  source_key: string;
  external_id?: string;
  display_name?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: number;
  user_id: number;
  plan_code: string;
  status: SubscriptionStatus;
  current_period_start?: string;
  current_period_end?: string;
  trial_end?: string;
  canceled_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ClientProfile {
  id: string;
  name: string;
  industry?: string;
  icp: ICPProfile;
  daily_digest_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ICPProfile {
  company_sizes: Array<'startup' | 'small' | 'medium' | 'large' | 'enterprise'>;
  industries: string[];
  locations: string[];
  roles: string[];
  technologies?: string[];
  exclusions?: string[];
}

export interface Signal {
  id: string;
  org_id: number;
  source_key: string;
  source_external_id: string;
  source_display_name: string;
  source_families: string[];
  kind: SignalKind;
  title?: string;
  description?: string;
  published_at?: string;
  url?: string;
  metadata: Record<string, unknown>;
  is_duplicate: boolean;
  duplicate_of?: string;
  confidence_gate: 'A' | 'B' | 'C' | 'D';
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  client_profile_id: string;
  signal_id: string;
  state: LeadState;
  score: number;
  feedback_status: DigestFeedbackStatus;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface DigestRun {
  id: string;
  client_profile_id: string;
  source_key: string;
  status: DigestRunStatus;
  requested_limit: number;
  selected_count: number;
  cooldown_days: number;
  created_at: string;
  completed_at?: string;
}

export interface DigestItem {
  id: string;
  digest_run_id: string;
  rank: number;
  org_id: string;
  source_external_id: string;
  source_display_name: string;
  source_families: string[];
  evidence_titles: string[];
  candidate_source_keys: string[];
  location_names: string[];
  vacancies_count: number;
  distinct_vacancy_names_count: number;
  latest_published_at: string;
  total_score: number;
  reasons: [string, string];
  opener: string;
  confidence_gate: 'A' | 'B' | 'C' | 'D';
  created_at: string;
  primary_reason_label?: string;
  secondary_reason_label?: string;
  /**
   * Company career-page URL (from orgs), joined into the evidence query so the
   * geo gate can detect a foreign ATS host (boards.greenhouse.io, jobs.lever.co)
   * even when the source keys carry only a clean domain. Query-projection field.
   */
  career_page_url?: string | null;
  /**
   * Geo gate (Block 1): true when the lead is a foreign employer — hosted on a
   * known foreign ATS with no Russian-market footprint. When set, total_score has
   * already had the soft foreign-employer penalty applied. Surfaced to the UI as
   * an «Иностранный работодатель» badge.
   */
  is_foreign_employer?: boolean;
  /** The foreign ATS domain that triggered the geo flag, when is_foreign_employer. */
  foreign_matched_domain?: string | null;
}

export interface DigestDelivery {
  id: string;
  digest_run_id: string;
  telegram_chat_id: number;
  delivery_status: DeliveryStatus;
  message_id?: number;
  error_message?: string;
  created_at: string;
  sent_at?: string;
}

export interface DigestFeedback {
  id: string;
  digest_item_id: string;
  lead_id: string;
  feedback_status: DigestFeedbackStatus;
  action_taken_at: string;
  metadata: Record<string, unknown>;
}

// Database Query Types
export interface WhereClause {
  column: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'NOT IN' | 'LIKE' | 'ILIKE';
  value: unknown;
}

export interface OrderByClause {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface QueryOptions {
  where?: WhereClause[];
  orderBy?: OrderByClause[];
  limit?: number;
  offset?: number;
}

// Common Result Types
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DatabaseError extends Error {
  code: string;
  table?: string;
  column?: string;
  constraint?: string;
}

// Transaction Types
export interface TransactionClient {
  query: (text: string, params?: unknown[]) => Promise<{
    rows: unknown[];
    rowCount: number;
    fields: unknown[];
  }>;
  begin: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

// Database Migration Types
export interface Migration {
  id: string;
  name: string;
  sql: string;
  checksum: string;
  executed_at: string;
}

// Common Helper Types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export interface AuditFields {
  created_at: string;
  updated_at: string;
}

export interface SoftDeleteFields extends AuditFields {
  deleted_at?: string;
}

// Backward compatibility types
import { Pool, type PoolClient } from "pg";

export type DigestDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;
export type QueryResult = {
  rows: unknown[];
  rowCount: number;
  fields: unknown[];
};

export type DigestRunRow = DigestRun;
export type DigestEvidenceRow = DigestItem;
export type DigestCandidateInsertRow = DigestItem;