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

const CACHE_DIR = resolve(process.cwd(), '.cache/dedupe');
const SUPPRESSIONS_FILE = resolve(CACHE_DIR, 'suppressions.json');
const METRICS_FILE = resolve(CACHE_DIR, 'metrics.json');
const CACHE_TTL = 24 * 60 * 60 * 1000;

if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

export function buildSignalExternalId(sourceId, externalId, sourceUrl, primarySourceKey, lineNumber) {
  const idParts = [
    sourceId,
    externalId,
    primarySourceKey,
  ].filter(Boolean);

  return idParts.join(':');
}

export function buildEntityIdentityHash(companyName, companyDomain, inn, ogrn) {
  const normalized = {
    company: companyName?.toLowerCase().trim(),
    domain: normalizeDomain(companyDomain),
    inn: normalizeInn(inn),
    ogrn: normalizeOgrn(ogrn),
  };

  const hashInput = [
    normalized.company,
    normalized.domain,
    normalized.inn,
    normalized.ogrn,
  ].filter(Boolean).join('|');

  return createHash('sha256').update(hashInput).digest('hex');
}

function normalizeDomain(domain) {
  if (!domain) return null;
  return domain.toLowerCase().replace(/^www\./, '');
}

function normalizeInn(inn) {
  if (!inn) return null;
  const cleaned = inn.toString().replace(/\D/g, '');
  return cleaned.length === 10 ? cleaned : null;
}

function normalizeOgrn(ogrn) {
  if (!ogrn) return null;
  const cleaned = ogrn.toString().replace(/\D/g, '');
  return cleaned.length === 13 ? cleaned : null;
}

export class DedupeService {
  constructor(config = {}) {
    this.suppressions = this.loadSuppressions();
    this.metrics = this.loadMetrics();
    this.entityCache = new Map();
    this.signalCache = new Map();
  }

  loadSuppressions() {
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

  loadMetrics() {
    try {
      if (existsSync(METRICS_FILE)) {
        const data = readFileSync(METRICS_FILE, 'utf8');
        const parsed = JSON.parse(data, (key, value) => {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
          }
          return value;
        });

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

  getDefaultMetrics() {
    return {
      totalSignals: 0,
      duplicatesDetected: 0,
      suppressedSignals: 0,
      duplicateRate: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  saveState() {
    try {
      writeFileSync(SUPPRESSIONS_FILE, JSON.stringify(Object.fromEntries(this.suppressions), null, 2));
      writeFileSync(METRICS_FILE, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      console.error(`Failed to save dedupe state: ${error.message}`);
    }
  }

  isDuplicate(signal) {
    const signalId = signal.signalExternalId;
    const entityHash = signal.entityIdentityHash;

    if (this.signalCache.has(signalId)) {
      this.metrics.duplicatesDetected++;
      return {
        isDuplicate: true,
        duplicateOf: signalId,
        confidence: 1.0,
      };
    }

    if (this.entityCache.has(entityHash)) {
      const existingSignal = this.entityCache.get(entityHash);
      if (this.isSameEntity(signal, existingSignal)) {
        this.metrics.duplicatesDetected++;
        return {
          isDuplicate: true,
          duplicateOf: entityHash,
          confidence: 0.9,
        };
      }
    }

    this.signalCache.set(signalId, signal);
    this.entityCache.set(entityHash, signal);

    return {
      isDuplicate: false,
      confidence: 0.0,
    };
  }

  isSameEntity(a, b) {
    const score = this.calculateEntityMatchScore(a, b);
    return score >= 0.8;
  }

  calculateEntityMatchScore(a, b) {
    let score = 0;
    let maxScore = 0;

    if (a.companyDomain && b.companyDomain) {
      if (normalizeDomain(a.companyDomain) === normalizeDomain(b.companyDomain)) {
        score += 0.5;
      }
      maxScore += 0.5;
    }

    if (a.inn && b.inn && normalizeInn(a.inn) === normalizeInn(b.inn)) {
      score += 0.4;
      maxScore += 0.4;
    }

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

  isSuppressed(signalId) {
    return this.suppressions.has(signalId);
  }

  getSuppressionReason(signalId) {
    const suppression = this.suppressions.get(signalId);
    return suppression?.reason || 'unknown';
  }

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

  updateMetrics(sourceId, processedCount, duplicateCount) {
    this.metrics.totalSignals += processedCount;
    this.metrics.duplicatesDetected += duplicateCount;
    this.metrics.duplicateRate = this.metrics.totalSignals > 0
      ? this.metrics.duplicatesDetected / this.metrics.totalSignals
      : 0;
    this.metrics.lastUpdated = new Date().toISOString();

    this.saveState();
  }

  getQualityReport() {
    const total = this.metrics.totalSignals;
    return {
      ...this.metrics,
      suppressionRate: total > 0 ? this.metrics.suppressedSignals / total : 0,
      uniqueSignals: total - this.metrics.duplicatesDetected,
      effectiveness: total > 0
        ? `${(this.metrics.duplicatesDetected / total * 100).toFixed(2)}%`
        : '0.00%',
    };
  }

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
      console.log(`Cleared ${cleared} old suppressions`);
    }

    return cleared;
  }

  exportStats() {
    return {
      bySource: this.groupMetricsBySource(),
      byReason: this.groupSuppressionsByReason(),
      dailyTrend: this.calculateDailyTrend(),
    };
  }

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

  calculateDailyTrend() {
    const now = new Date();
    const days = 7;
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const dayKey = day.toISOString().split('T')[0];

      const daySuppressions = Array.from(this.suppressions.values()).filter((s) =>
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

let dedupeService = null;

export function getDedupeService() {
  if (!dedupeService) {
    dedupeService = new DedupeService();
  }
  return dedupeService;
}

export function cleanupDedupeService() {
  const service = getDedupeService();
  const cleared = service.clearOldSuppressions(30);

  if (cleared > 0) {
    console.log(`Dedupe cleanup completed: ${cleared} old suppressions removed`);
  }

  return cleared;
}
