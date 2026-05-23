#!/usr/bin/env node

/**
 * Anti-Duplication Service for Recruiter Radar
 *
 * Provides:
 * - Duplicate detection across sources
 * - Signal suppression tracking
 * - Quality metrics
 * - Memory-efficient caching
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Import types
import type {
  DedupeServiceConfig,
  SignalIdentity,
  EntityIdentity,
  DuplicateResult
} from '../lib/business-logic-types';

// Constants
const CACHE_DIR = resolve(process.cwd(), '.cache/dedupe');
const SUPPRESSIONS_FILE = resolve(CACHE_DIR, 'suppressions.json');
const METRICS_FILE = resolve(CACHE_DIR, 'metrics.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Initialize cache directory
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

// Dedupe keys generation
export function buildSignalExternalId(sourceId: string, externalId: string | null, sourceUrl: string, primarySourceKey: string, lineNumber?: number): string {
  // Create a unique identifier for this signal
  const idParts = [
    sourceId,
    externalId,
    primarySourceKey,
  ].filter(Boolean);

  return idParts.join(':');
}

// Entity identity hash for cross-source dedupe
export function buildEntityIdentityHash(companyName: string, companyDomain?: string, inn?: string, ogrn?: string): string {
  const normalized = {
    company: companyName?.toLowerCase().trim(),
    domain: normalizeDomain(companyDomain),
    inn: normalizeInn(inn),
    ogrn: normalizeOgrn(ogrn),
  };

  // Create hash for efficient comparison
  const hashInput = [
    normalized.company,
    normalized.domain,
    normalized.inn,
    normalized.ogrn,
  ].filter(Boolean).join('|');

  return createHash('sha256').update(hashInput).digest('hex');
}

// Normalization helpers
function normalizeDomain(domain?: string): string | null {
  if (!domain) return null;
  return domain.toLowerCase().replace(/^www\./, '');
}

function normalizeInn(inn?: string): string | null {
  if (!inn) return null;
  const cleaned = inn.toString().replace(/\D/g, '');
  return cleaned.length === 10 ? cleaned : null;
}

function normalizeOgrn(ogrn?: string): string | null {
  if (!ogrn) return null;
  const cleaned = ogrn.toString().replace(/\D/g, '');
  return cleaned.length === 13 ? cleaned : null;
}

// Main dedupe service
export class DedupeService {
  private suppressions: Map<string, { timestamp: string; reason?: string }>;
  private metrics: {
    totalSignals: number;
    duplicatesFound: number;
    falsePositives: number;
    lastUpdated: string;
  };
  private entityCache: Map<string, { id: string; timestamp: number }>;
  private signalCache: Map<string, { id: string; timestamp: number }>;

  constructor(config: DedupeServiceConfig = {}) {
    this.suppressions = this.loadSuppressions();
    this.metrics = this.loadMetrics();
    this.entityCache = new Map();
    this.signalCache = new Map();
  }

  // Load suppression list from file
  private loadSuppressions(): Map<string, { timestamp: string; reason?: string }> {
    try {
      if (existsSync(SUPPRESSIONS_FILE)) {
        const data = JSON.parse(readFileSync(SUPPRESSIONS_FILE, 'utf8'));
        return new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn(`Failed to load suppressions: ${error.message}`);
    }
    return new Map();
  }

  // Load metrics from file
  loadMetrics() {
    try {
      if (existsSync(METRICS_FILE)) {
        const data = readFileSync(METRICS_FILE, 'utf8');
        // Safe JSON parsing with prototype pollution protection
        const parsed = JSON.parse(data, (key, value) => {
          // Skip prototype properties
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
          }
          return value;
        });

        // Validate metrics structure
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
          console.warn('Invalid metrics format, using defaults');
          return this.getDefaultMetrics();
        }

        return parsed;
      }
    } catch (error) {
      console.warn(`Failed to load metrics: ${error.message}`);
    }
    return this.getDefaultMetrics();
  }

  // Get default metrics structure
  getDefaultMetrics() {
    return {
      totalSignals: 0,
      duplicatesDetected: 0,
      suppressedSignals: 0,
      duplicateRate: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  // Save state to files
  saveState() {
    try {
      writeFileSync(SUPPRESSIONS_FILE, JSON.stringify(Object.fromEntries(this.suppressions), null, 2));
      writeFileSync(METRICS_FILE, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      console.error(`Failed to save dedupe state: ${error.message}`);
    }
  }

  // Check if signal is duplicate
  isDuplicate(signal: { signalExternalId: string; entityIdentityHash: string; entityIdentity: EntityIdentity }): DuplicateResult {
    const signalId = signal.signalExternalId;
    const entityHash = signal.entityIdentityHash;

    // Check exact signal duplicate
    if (this.signalCache.has(signalId)) {
      this.metrics.duplicatesDetected++;
      return {
        isDuplicate: true,
        duplicateOf: signalId,
        confidence: 1.0
      };
    }

    // Check entity-level duplicate
    if (this.entityCache.has(entityHash)) {
      const existingSignal = this.entityCache.get(entityHash);
      if (this.isSameEntity(signal, existingSignal)) {
        this.metrics.duplicatesDetected++;
        return {
          isDuplicate: true,
          duplicateOf: entityHash,
          confidence: 0.9
        };
      }
    }

    // Update cache
    this.signalCache.set(signalId, signal);
    this.entityCache.set(entityHash, signal);

    return {
      isDuplicate: false,
      confidence: 0.0
    };
  }

  // Check if two signals represent the same entity
  private isSameEntity(a: EntityIdentity, b: EntityIdentity): number {
    const score = this.calculateEntityMatchScore(a, b);
    return score >= 0.8; // 80% threshold for entity match
  }

  // Calculate entity similarity score
  calculateEntityMatchScore(a, b) {
    let score = 0;
    let maxScore = 0;

    // Domain match (highest weight)
    if (a.companyDomain && b.companyDomain) {
      if (normalizeDomain(a.companyDomain) === normalizeDomain(b.companyDomain)) {
        score += 0.5;
      }
      maxScore += 0.5;
    }

    // INN match (high weight)
    if (a.inn && b.inn && normalizeInn(a.inn) === normalizeInn(b.inn)) {
      score += 0.4;
      maxScore += 0.4;
    }

    // Company name match
    if (a.companyName && b.companyName) {
      const normA = a.companyName.toLowerCase().trim();
      const normB = b.companyName.toLowerCase().trim();
      if (normA === normB) {
        score += 0.3;
      } else if (normA.includes(normB) || normB.includes(normA)) {
        score += 0.15;
      }
      maxScore += 0.3;
    }

    return maxScore > 0 ? score / maxScore : 0;
  }

  // Suppress duplicate signal
  suppressDuplicate(signal, reason = 'duplicate') {
    const suppression = {
      signalId: signal.signalExternalId,
      entityId: signal.entityIdentityHash,
      sourceId: signal.sourceId,
      timestamp: new Date().toISOString(),
      reason,
    };

    this.suppressions.set(signal.signalExternalId, suppression);
    this.metrics.suppressedSignals++;

    this.saveState();
    return suppression;
  }

  // Check if signal is suppressed
  isSuppressed(signalId) {
    return this.suppressions.has(signalId);
  }

  // Get suppression reason
  getSuppressionReason(signalId) {
    const suppression = this.suppressions.get(signalId);
    return suppression?.reason || 'unknown';
  }

  // Add feedback-based suppression
  addFeedbackSuppression(signalId, feedbackType) {
    const suppression = {
      signalId,
      entityId: this.entityCache.get(signalId)?.entityIdentityHash,
      sourceId: this.entityCache.get(signalId)?.sourceId,
      timestamp: new Date().toISOString(),
      reason: `feedback:${feedbackType}`,
    };

    this.suppressions.set(signalId, suppression);
    this.metrics.suppressedSignals++;

    this.saveState();
    return suppression;
  }

  // Update metrics
  updateMetrics(sourceId, processedCount, duplicateCount) {
    this.metrics.totalSignals += processedCount;
    this.metrics.duplicatesDetected += duplicateCount;
    this.metrics.duplicateRate = this.metrics.duplicatesDetected / this.metrics.totalSignals;
    this.metrics.lastUpdated = new Date().toISOString();

    this.saveState();
  }

  // Get quality report
  getQualityReport() {
    return {
      ...this.metrics,
      suppressionRate: this.metrics.suppressedSignals / this.metrics.totalSignals || 0,
      uniqueSignals: this.metrics.totalSignals - this.metrics.duplicatesDetected,
      effectiveness: (this.metrics.duplicatesDetected / this.metrics.totalSignals * 100).toFixed(2) + '%',
    };
  }

  // Clear old suppressions
  clearOldSuppressions(olderThanDays = 30) {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    let cleared = 0;

    for (const [signalId, suppression] of this.suppressions) {
      const suppressDate = new Date(suppression.timestamp);
      if (suppressDate < cutoff) {
        this.suppressions.delete(signalId);
        cleared++;
      }
    }

    if (cleared > 0) {
      this.saveState();
      console.log(`🧹 Cleared ${cleared} old suppressions`);
    }

    return cleared;
  }

  // Export dedupe statistics
  exportStats() {
    return {
      bySource: this.groupMetricsBySource(),
      byReason: this.groupSuppressionsByReason(),
      dailyTrend: this.calculateDailyTrend(),
    };
  }

  // Group metrics by source
  groupMetricsBySource() {
    const bySource = {};

    for (const [signalId, suppression] of this.suppressions) {
      const source = suppression.sourceId;
      if (!bySource[source]) {
        bySource[source] = { count: 0, reasons: {} };
      }
      bySource[source].count++;
      bySource[source].reasons[suppression.reason] = (bySource[source].reasons[suppression.reason] || 0) + 1;
    }

    return bySource;
  }

  // Group suppressions by reason
  groupSuppressionsByReason() {
    const byReason = {};

    for (const suppression of this.suppressions.values()) {
      const reason = suppression.reason;
      if (!byReason[reason]) {
        byReason[reason] = { count: 0, sources: new Set() };
      }
      byReason[reason].count++;
      byReason[reason].sources.add(suppression.sourceId);
    }

    return byReason;
  }

  // Calculate daily trend (simplified)
  calculateDailyTrend() {
    const now = new Date();
    const days = 7;
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const dayKey = day.toISOString().split('T')[0];

      const daySuppressions = Array.from(this.suppressions.values()).filter(s =>
        s.timestamp.startsWith(dayKey)
      );

      trend.push({
        date: dayKey,
        suppressions: daySuppressions.length,
      });
    }

    return trend;
  }
}

// Initialize global dedupe service instance
let dedupeService = null;

export function getDedupeService() {
  if (!dedupeService) {
    dedupeService = new DedupeService();
  }
  return dedupeService;
}

// Cleanup function for periodic maintenance
export function cleanupDedupeService() {
  const service = getDedupeService();
  const cleared = service.clearOldSuppressions(30);

  if (cleared > 0) {
    console.log(`🧹 Dedupe cleanup completed: ${cleared} old suppressions removed`);
  }

  return cleared;
}