import crypto from 'node:crypto';
import pg from 'pg';
import { deriveTemporalEvents } from './lib/source-temporal-intelligence.mjs';

const { Client } = pg;
const SUBJECT_BY_SOURCE = new Map([
  ['fns-open-data', 'fns_company'], ['government-procurement', 'government_procurement'], ['rospatent-open-data', 'rospatent'],
]);

export async function deriveSourceTemporalIntelligence({ connectionString = process.env.DATABASE_URL, now = new Date() } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const client = new Client({ connectionString }); await client.connect();
  let observations = 0, events = 0;
  try {
    const rows = (await client.query(`SELECT signal.org_id, signal.source, signal.signal_type::TEXT, signal.headline, signal.payload, signal.updated_at, ARRAY_AGG(DISTINCT lineage.evidence_id) FILTER (WHERE lineage.evidence_id IS NOT NULL) AS evidence_ids FROM signals signal LEFT JOIN source_signal_evidence_lineage_v1 lineage ON lineage.signal_id=signal.id AND lineage.organization_id=signal.org_id WHERE signal.updated_at BETWEEN $1::TIMESTAMPTZ - INTERVAL '30 days' AND $1::TIMESTAMPTZ GROUP BY signal.id`, [now.toISOString()])).rows;
    const groups = groupRows(rows);
    await client.query('BEGIN');
    for (const group of groups) {
      const metrics = buildMetrics(group.subjectType, group.rows);
      const observationFingerprint = hash([group.orgId, group.subjectType, now.toISOString().slice(0, 10), metrics]);
      const inserted = await client.query(`INSERT INTO source_temporal_observations (organization_id,source_family,subject_type,subject_key,observed_at,metrics,evidence_ids,observation_fingerprint) VALUES ($1,$2,$3,$4,$5,$6::JSONB,$7,$8) ON CONFLICT (observation_fingerprint) DO NOTHING RETURNING id`, [group.orgId, group.sourceFamily, group.subjectType, `${group.orgId}:${group.subjectType}`, now.toISOString(), JSON.stringify(metrics), group.evidenceIds, observationFingerprint]);
      if (!inserted.rowCount) continue;
      observations += 1; const currentId = inserted.rows[0].id;
      const historyRows = (await client.query(`SELECT id,observed_at,metrics,evidence_ids FROM source_temporal_observations WHERE organization_id=$1 AND subject_type=$2 AND id<>$3 AND observed_at >= $4::TIMESTAMPTZ - INTERVAL '31 days' ORDER BY observed_at DESC`, [group.orgId, group.subjectType, currentId, now.toISOString()])).rows;
      const history = historyRows.map((x) => ({ ...x, ageDays: Math.max(0, Math.floor((now.getTime() - new Date(x.observed_at).getTime()) / 86_400_000)) }));
      for (const event of deriveTemporalEvents({ subjectType: group.subjectType, current: metrics, history })) {
        const previous = history.find((x) => event.windowDays == null || x.ageDays >= event.windowDays) ?? history[0];
        const eventFingerprint = hash([group.orgId, group.subjectType, event.eventType, event.windowDays, currentId, event.delta]);
        const result = await client.query(`INSERT INTO source_temporal_derived_events (organization_id,subject_type,event_type,occurred_at,window_days,previous_observation_id,current_observation_id,delta,evidence_ids,event_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::JSONB,$9,$10) ON CONFLICT (event_fingerprint) DO NOTHING`, [group.orgId, group.subjectType, event.eventType, now.toISOString(), event.windowDays, previous?.id ?? null, currentId, JSON.stringify(event.delta), group.evidenceIds, eventFingerprint]); events += result.rowCount;
      }
    }
    await client.query('COMMIT'); return { observations, derivedEvents: events };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { await client.end(); }
}

function groupRows(rows) { const map = new Map(); for (const row of rows) { const subjectType = row.signal_type === 'job_posting' ? 'vacancies' : SUBJECT_BY_SOURCE.get(row.source); if (!subjectType) continue; const key = `${row.org_id}:${subjectType}`; const item = map.get(key) ?? { orgId: row.org_id, subjectType, sourceFamily: row.source, rows: [], evidenceIds: [] }; item.rows.push(row); item.evidenceIds.push(...(row.evidence_ids ?? [])); item.evidenceIds = [...new Set(item.evidenceIds.map(Number))]; map.set(key, item); } return [...map.values()]; }
function buildMetrics(type, rows) { if (type === 'vacancies') return { current_count: rows.length, roles: unique(rows.map((x) => x.headline)), reopened_roles: repeated(rows.map((x) => x.headline)), geographies: unique(rows.flatMap((x) => [x.payload?.location, x.payload?.area_name])), departments: unique(rows.flatMap((x) => [x.payload?.department, x.payload?.function])) }; if (type === 'fns_company') return latest(rows, { headcount: ['employee_count','headcount'], revenue: ['revenue'], support_count: ['support_count'] }); if (type === 'government_procurement') return { contract_count: rows.length, aggregate_value: rows.reduce((n,x)=>n+num(x.payload?.contract_value ?? x.payload?.value),0), customers: unique(rows.map((x)=>x.payload?.customer_name)), regions: unique(rows.map((x)=>x.payload?.region)) }; return { application_count: rows.filter((x)=>/application/i.test(x.payload?.status ?? '')).length, registration_count: rows.filter((x)=>/registration|registered/i.test(x.payload?.status ?? '')).length } }
function latest(rows, mapping) { const row=[...rows].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at))[0]??{}; return Object.fromEntries(Object.entries(mapping).map(([out,keys])=>[out,num(keys.map((k)=>row.payload?.[k]).find((v)=>v!=null))])); }
function unique(v){return [...new Set(v.map((x)=>String(x??'').trim()).filter(Boolean))]}; function repeated(v){const c=new Map();for(const raw of v){const x=String(raw??'').trim();if(x)c.set(x,(c.get(x)??0)+1)}return [...c].filter(([,n])=>n>1).map(([x])=>x)}; function num(v){const n=Number(v);return Number.isFinite(n)?n:0}; function hash(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\','/')}`) console.log(JSON.stringify(await deriveSourceTemporalIntelligence(), null, 2));
