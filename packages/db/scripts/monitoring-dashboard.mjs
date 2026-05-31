#!/usr/bin/env node

/**
 * Monitoring Dashboard
 *
 * Displays real-time metrics and health status
 */

import { performHealthCheck } from './monitoring-service.mjs';

console.log('📊 Recruiter Radar - Monitoring Dashboard\n');

const dashboard = performHealthCheck();

// Display source health
console.log('\n🎯 Source Health');
console.log('-' .repeat(40));

const sources = dashboard.sources;
const sortedSources = Object.entries(sources)
  .sort(([,a], [,b]) => (b?.overall || 0) - (a?.overall || 0));

sortedSources.forEach(([sourceId, health]) => {
  if (!health) return;

  const bar = '█'.repeat(Math.floor(health.overall / 10));
  const status = health.overall >= 80 ? '✅' :
                 health.overall >= 60 ? '⚠️' : '❌';

  console.log(`${status} ${sourceId.padEnd(20)} |${bar.padEnd(10)}| ${health.overall.toFixed(1)}/100`);
});

// Display recent alerts
console.log('\n🚨 Recent Alerts');
console.log('-' .repeat(40));

const recentAlerts = dashboard.alerts.slice(-5);
if (recentAlerts.length === 0) {
  console.log('No active alerts');
} else {
  recentAlerts.forEach(alert => {
    const emoji = alert.level === 'critical' ? '🚨' : '⚠️';
    console.log(`${emoji} ${alert.timestamp.split('T')[0]} ${alert.message}`);
  });
}

// Display metrics trends
console.log('\n📈 Metrics Trends');
console.log('-' .repeat(40));

console.log('Top performing sources:');
const topSources = sortedSources.slice(0, 3);
topSources.forEach(([sourceId, health]) => {
  console.log(`  - ${sourceId}: ${health.overall.toFixed(1)}%`);
});

console.log('\nSources needing attention:');
const poorSources = sortedSources.filter(([_, health]) => health && health.overall < 70);
poorSources.forEach(([sourceId, health]) => {
  console.log(`  - ${sourceId}: ${health.overall.toFixed(1)}%`);
});

// Generate report
const monitoring = (await import('./monitoring-service.mjs')).getMonitoringService();
const report = monitoring.generateReport('daily');

console.log('\n💡 Recommendations');
console.log('-' .repeat(40));
if (report.recommendations.length === 0) {
  console.log('✅ No recommendations - all systems healthy');
} else {
  report.recommendations.forEach(rec => {
    console.log(`\n🔧 ${rec.sourceId} (${rec.priority}):`);
    console.log(`   Issue: ${rec.issue}`);
    rec.actions.forEach(action => {
      console.log(`   - ${action}`);
    });
  });
}

// Performance summary
console.log('\n⚡ Performance Summary');
console.log('-' .repeat(40));
console.log(`Sources monitored: ${Object.keys(sources).length}`);
console.log(`System health: ${dashboard.overview.overallHealth.toFixed(1)}/100`);
console.log(`Active alerts: ${dashboard.overview.totalAlerts}`);

console.log('\n✅ Dashboard refresh completed');