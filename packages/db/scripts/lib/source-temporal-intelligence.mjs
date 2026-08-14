const WINDOWS = [7, 14, 30];

export function deriveTemporalEvents({ subjectType, current, history }) {
  if (!current || typeof current !== 'object' || !Array.isArray(history)) return [];
  const events = [];
  const previous = closest(history);
  if (subjectType === 'vacancies') {
    for (const windowDays of WINDOWS) {
      const prior = atWindow(history, windowDays);
      if (!prior) continue;
      const change = number(current.current_count) - number(prior.metrics.current_count);
      if (change) events.push({ eventType: 'vacancy_count_change', windowDays, delta: { previous: number(prior.metrics.current_count), current: number(current.current_count), change } });
      const accelerationThreshold = Math.max(3, Math.ceil(number(prior.metrics.current_count) * 0.25));
      if (change >= accelerationThreshold) events.push({ eventType: 'hiring_acceleration', windowDays, delta: { previous: number(prior.metrics.current_count), current: number(current.current_count), change } });
    }
    if (previous) {
      addSetEvent(events, 'roles_newly_opened', current.roles, previous.metrics?.roles);
      const priorLifecycleIds = new Set(history.flatMap((item) =>
        lifecycleEvents(item.metrics?.lifecycle_events).map((event) => event.id)));
      for (const event of lifecycleEvents(current.lifecycle_events)) {
        if (priorLifecycleIds.has(event.id)) continue;
        if (event.type === 'reopened') events.push({ eventType: 'role_reopened', windowDays: null, delta: { role: event.role, lifecycleEventId: event.id } });
        if (event.type === 'closed') events.push({ eventType: 'role_closed', windowDays: null, delta: { role: event.role, lifecycleEventId: event.id } });
      }
      addSetEvent(events, 'geography_expansion', current.geographies, previous.metrics?.geographies);
      addSetEvent(events, 'new_department', current.departments, previous.metrics?.departments);
    }
  } else if (subjectType === 'fns_company') {
    addTrajectory(events, 'headcount_trajectory', current, history, 'headcount');
    addTrajectory(events, 'revenue_trajectory', current, history, 'revenue');
    addTrajectory(events, 'support_change', current, history, 'support_count');
  } else if (subjectType === 'government_procurement') {
    const prior = atWindow(history, 30) ?? previous;
    if (prior) {
      const countDelta = number(current.contract_count) - number(prior.metrics.contract_count);
      if (number(prior.metrics.contract_count) === 0 && number(current.contract_count) > 0) events.push({ eventType: 'first_large_contract', windowDays: 30, delta: { current: number(current.contract_count) } });
      if (countDelta >= 2) events.push({ eventType: 'contract_series', windowDays: 30, delta: { change: countDelta } });
      const valueDelta = number(current.aggregate_value) - number(prior.metrics.aggregate_value);
      if (valueDelta > Math.max(0, number(prior.metrics.aggregate_value))) events.push({ eventType: 'aggregate_value_acceleration', windowDays: 30, delta: { change: valueDelta } });
      addSetEvent(events, 'new_customer', current.customers, prior.metrics.customers, 30);
      addSetEvent(events, 'new_region', current.regions, prior.metrics.regions, 30);
    }
  } else if (subjectType === 'rospatent') {
    addTrajectory(events, 'new_application', current, history, 'application_count');
    addTrajectory(events, 'new_registration', current, history, 'registration_count');
    const prior = atWindow(history, 30);
    if (prior && number(current.application_count) - number(prior.metrics.application_count) >= 3) events.push({ eventType: 'application_count_acceleration', windowDays: 30, delta: { change: number(current.application_count) - number(prior.metrics.application_count) } });
  }
  return events;
}

function addTrajectory(out, eventType, current, history, key) { const prior = atWindow(history, 30) ?? closest(history); if (!prior) return; const change = number(current[key]) - number(prior.metrics[key]); if (change) out.push({ eventType, windowDays: prior.ageDays ?? null, delta: { metric: key, previous: number(prior.metrics[key]), current: number(current[key]), change } }); }
function addSetEvent(out, eventType, now, before, windowDays = null) { const old = new Set(strings(before).map((x) => x.toLowerCase())); const added = strings(now).filter((x) => !old.has(x.toLowerCase())); if (added.length) out.push({ eventType, windowDays, delta: { added } }); }
function atWindow(history, days) { return history.filter((x) => Number(x.ageDays) >= days).sort((a, b) => Number(a.ageDays) - Number(b.ageDays))[0] ?? null; }
function closest(history) { return [...history].sort((a, b) => Number(a.ageDays) - Number(b.ageDays))[0] ?? null; }
function number(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function strings(v) { return Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : []; }
function lifecycleEvents(value) { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && item.id != null && ['opened', 'closed', 'reopened'].includes(item.type)).map((item) => ({ id: String(item.id), type: item.type, role: String(item.role ?? '').trim() })).filter((item) => item.role) : []; }
