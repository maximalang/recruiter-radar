#!/usr/bin/env node

/**
 * Monitoring Service for Recruiter Radar
 *
 * Collects and tracks metrics for all sources:
 * - Performance metrics (latency, success rate)
 * - Quality metrics (freshness, confidence)
 * - Business metrics (lead generation, duplicates)
 * - Health checks
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const METRICS_DIR = resolve(scriptDir, './metrics');

// Initialize metrics directory
if (!existsSync(METRICS_DIR)) {
  writeFileSync(METRICS_DIR, '', { recursive: true });
}

// Metric definitions
const METRIC_TYPES = {
  // Performance metrics
  LATENCY: 'latency',
  SUCCESS_RATE: 'success_rate',
  ERROR_RATE: 'error_rate',
  THROUGHPUT: 'throughput',

  // Quality metrics
  FRESHNESS: 'freshness',
  CONFIDENCE: 'confidence',
  COMPLETENESS: 'completeness',
  ACCURACY: 'accuracy',

  // Business metrics
  LEADS_GENERATED: 'leads_generated',
  DUPLICATE_RATE: 'duplicate_rate',
  SUPPRESSION_RATE: 'suppression_rate',

  // Health metrics
  AVAILABILITY: 'availability',
  RESPONSE_TIME: 'response_time',
  ERROR_COUNT: 'error_count',
};

// Metric categories
const CATEGORIES = {
  SOURCE: 'source',
  SYSTEM: 'system',
  BUSINESS: 'business',
};

// Monitoring service
export class MonitoringService {
  constructor() {
    this.metrics = {
      bySource: {},
      byCategory: {},
      overall: {
        uptime: 0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
      },
    };
    this.alerts = [];
    this.loadMetrics();
  }

  // Load existing metrics
  loadMetrics() {
    try {
      const metricsFile = resolve(METRICS_DIR, 'current.json');
      if (existsSync(metricsFile)) {
        const data = JSON.parse(readFileSync(metricsFile, 'utf8'));
        this.metrics = data;
      }
    } catch (error) {
      console.warn(`Failed to load metrics: ${error.message}`);
    }
  }

  // Save metrics
  saveMetrics() {
    try {
      writeFileSync(resolve(METRICS_DIR, 'current.json'), JSON.stringify(this.metrics, null, 2));
      writeFileSync(resolve(METRICS_DIR, 'latest.json'), JSON.stringify(this.metrics, null, 2));

      // Create timestamped archive
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(resolve(METRICS_DIR, `archive-${timestamp}.json`), JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      console.error(`Failed to save metrics: ${error.message}`);
    }
  }

  // Record a metric
  record(sourceId, metricType, value, category = CATEGORIES.SOURCE, timestamp = new Date()) {
    if (!this.metrics.bySource[sourceId]) {
      this.metrics.bySource[sourceId] = {
        id: sourceId,
        name: sourceId,
        metrics: {},
        history: [],
      };
    }

    // Initialize metric type if not exists
    if (!this.metrics.bySource[sourceId].metrics[metricType]) {
      this.metrics.bySource[sourceId].metrics[metricType] = {
        current: value,
        min: value,
        max: value,
        avg: value,
        count: 1,
        timestamps: [timestamp],
      };
    } else {
      const metric = this.metrics.bySource[sourceId].metrics[metricType];
      metric.current = value;
      metric.min = Math.min(metric.min, value);
      metric.max = Math.max(metric.max, value);
      metric.avg = ((metric.avg * metric.count) + value) / (metric.count + 1);
      metric.count++;
      metric.timestamps.push(timestamp);
    }

    // Update category metrics
    if (!this.metrics.byCategory[category]) {
      this.metrics.byCategory[category] = {};
    }
    if (!this.metrics.byCategory[category][metricType]) {
      this.metrics.byCategory[category][metricType] = [];
    }
    this.metrics.byCategory[category][metricType].push({
      sourceId,
      value,
      timestamp,
    });

    // Check for alerts
    this.checkAlerts(sourceId, metricType, value);

    this.saveMetrics();
  }

  // Check alert conditions
  checkAlerts(sourceId, metricType, value) {
    const alertRules = {
      [METRIC_TYPES.LATENCY]: {
        warning: 5000,
        critical: 10000,
      },
      [METRIC_TYPES.ERROR_RATE]: {
        warning: 0.1,
        critical: 0.3,
      },
      [METRIC_TYPES.FRESHNESS]: {
        warning: 0.7,
        critical: 0.5,
      },
      [METRIC_TYPES.CONFIDENCE]: {
        warning: 0.6,
        critical: 0.4,
      },
      [METRIC_TYPES.AVAILABILITY]: {
        warning: 0.95,
        critical: 0.9,
      },
    };

    const rules = alertRules[metricType];
    if (!rules) return;

    let level = null;
    if (value >= rules.critical) {
      level = 'critical';
    } else if (value >= rules.warning) {
      level = 'warning';
    }

    if (level) {
      const alert = {
        id: `${sourceId}-${metricType}-${Date.now()}`,
        sourceId,
        metricType,
        value,
        level,
        message: `${metricType} is ${level} for ${sourceId}: ${value}`,
        timestamp: new Date(),
      };

      this.alerts.push(alert);
      this.saveAlerts();

      // Log alert
      const emoji = level === 'critical' ? '🚨' : '⚠️';
      console.log(`${emoji} ${alert.message}`);
    }
  }

  // Record request metrics
  recordRequest(sourceId, success, latency, responseSize) {
    this.metrics.overall.totalRequests++;

    if (success) {
      this.metrics.overall.successfulRequests++;
      this.record(sourceId, METRIC_TYPES.SUCCESS_RATE, 1);
    } else {
      this.metrics.overall.failedRequests++;
      this.record(sourceId, METRIC_TYPES.ERROR_RATE, 1);
    }

    this.record(sourceId, METRIC_TYPES.LATENCY, latency);
    if (responseSize) {
      this.record(sourceId, METRIC_TYPES.THROUGHPUT, responseSize);
    }
  }

  // Get source health
  getSourceHealth(sourceId) {
    const source = this.metrics.bySource[sourceId];
    if (!source) return null;

    const health = {
      sourceId,
      overall: 0,
      metrics: {},
    };

    for (const [metricType, data] of Object.entries(source.metrics)) {
      const score = this.calculateMetricScore(metricType, data.current);
      health.metrics[metricType] = {
        value: data.current,
        score,
      };
      health.overall += score;
    }

    health.overall = health.overall / Object.keys(source.metrics).length;

    return health;
  }

  // Calculate metric score (0-100)
  calculateMetricScore(metricType, value) {
    switch (metricType) {
      case METRIC_TYPES.SUCCESS_RATE:
        return value * 100;
      case METRIC_TYPES.ERROR_RATE:
        return (1 - value) * 100;
      case METRIC_TYPES.LATENCY:
        // Lower latency is better
        if (value < 1000) return 100;
        if (value < 5000) return 80;
        if (value < 10000) return 60;
        return 40;
      case METRIC_TYPES.FRESHNESS:
        return value * 100;
      case METRIC_TYPES.CONFIDENCE:
        return value * 100;
      case METRIC_TYPES.AVAILABILITY:
        return value * 100;
      default:
        return value;
    }
  }

  // Get system dashboard
  getDashboard() {
    const dashboard = {
      timestamp: new Date().toISOString(),
      overview: {
        totalSources: Object.keys(this.metrics.bySource).length,
        totalAlerts: this.alerts.length,
        overallHealth: this.calculateSystemHealth(),
      },
      sources: {},
      alerts: this.alerts.slice(-10), // Last 10 alerts
      trends: this.calculateTrends(),
    };

    // Calculate source health
    for (const sourceId of Object.keys(this.metrics.bySource)) {
      dashboard.sources[sourceId] = this.getSourceHealth(sourceId);
    }

    return dashboard;
  }

  // Calculate system health
  calculateSystemHealth() {
    let totalScore = 0;
    let sourceCount = 0;

    for (const sourceId of Object.keys(this.metrics.bySource)) {
      const health = this.getSourceHealth(sourceId);
      if (health) {
        totalScore += health.overall;
        sourceCount++;
      }
    }

    return sourceCount > 0 ? totalScore / sourceCount : 0;
  }

  // Calculate trends
  calculateTrends() {
    const trends = {
      hourly: {},
      daily: {},
    };

    // Simple trend calculation based on recent data
    for (const [sourceId, source] of Object.entries(this.metrics.bySource)) {
      trends.hourly[sourceId] = {
        successRate: source.metrics.success_rate?.current || 0,
        latency: source.metrics.latency?.current || 0,
      };
    }

    return trends;
  }

  // Save alerts
  saveAlerts() {
    try {
      writeFileSync(resolve(METRICS_DIR, 'alerts.json'), JSON.stringify(this.alerts, null, 2));
    } catch (error) {
      console.error(`Failed to save alerts: ${error.message}`);
    }
  }

  // Get reports
  generateReport(period = 'daily') {
    const report = {
      period,
      generatedAt: new Date().toISOString(),
      summary: this.getDashboard().overview,
      sources: {},
      recommendations: [],
    };

    // Generate recommendations
    for (const [sourceId, source] of Object.entries(this.metrics.bySource)) {
      const health = this.getSourceHealth(sourceId);
      if (health && health.overall < 80) {
        report.recommendations.push({
          sourceId,
          issue: 'Poor performance detected',
          priority: health.overall < 60 ? 'high' : 'medium',
          actions: [
            'Check source configuration',
            'Review API rate limits',
            'Verify data quality',
          ],
        });
      }
    }

    return report;
  }
}

// Global monitoring instance
let monitoringService = null;

export function getMonitoringService() {
  if (!monitoringService) {
    monitoringService = new MonitoringService();
  }
  return monitoringService;
}

// Health check endpoint
export function performHealthCheck() {
  const monitoring = getMonitoringService();
  const dashboard = monitoring.getDashboard();

  console.log('🏥 System Health Check');
  console.log('=' .repeat(40));
  console.log(`Overall Health: ${dashboard.overview.overallHealth.toFixed(2)}/100`);
  console.log(`Active Sources: ${dashboard.overview.totalSources}`);
  console.log(`Active Alerts: ${dashboard.overview.totalAlerts}`);

  if (dashboard.overview.overallHealth < 80) {
    console.log('\n⚠️ System needs attention');
  } else {
    console.log('\n✅ System is healthy');
  }

  return dashboard;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitoring = getMonitoringService();

  // Demo: Record some sample metrics
  monitoring.record('hh', METRIC_TYPES.SUCCESS_RATE, 0.98);
  monitoring.record('hh', METRIC_TYPES.LATENCY, 1200);
  monitoring.record('career-pages', METRIC_TYPES.SUCCESS_RATE, 0.95);
  monitoring.record('career-pages', METRIC_TYPES.LATENCY, 800);

  // Generate and display dashboard
  const dashboard = monitoring.getDashboard();
  console.log(JSON.stringify(dashboard, null, 2));
}