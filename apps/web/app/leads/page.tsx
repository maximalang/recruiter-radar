import { Suspense } from 'react';
import Link from 'next/link';
import { getLeadsForProfile, type LeadItem } from '@/lib/leads-data';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import LeadsFilters from './leads-filters';

export const dynamic = 'force-dynamic';

const GATE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  A: { bg: '#d1fae5', color: '#065f46', label: 'Авто (A)' },
  B: { bg: '#dbeafe', color: '#1e40af', label: 'Авто с меткой (B)' },
  C: { bg: '#fef3c7', color: '#92400e', label: 'На проверке (C)' },
  D: { bg: '#f3f4f6', color: '#4b5563', label: 'Не доставлять (D)' },
};

const FEEDBACK_LABELS: Record<string, string> = {
  accepted: 'Беру',
  dismissed: 'Мимо',
  later: 'Позже',
  contacted: 'Уже написал',
  replied: 'Ответили',
  call: 'Созвон',
  client: 'Клиент',
  none: '',
};

function GateBadge({ gate }: { gate: string }) {
  const style = GATE_STYLES[gate] ?? GATE_STYLES.D;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </span>
  );
}

function FeedbackBadge({ status }: { status: string | null }) {
  if (!status || status === 'none') return null;
  const label = FEEDBACK_LABELS[status] ?? status;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 500,
        backgroundColor: '#f0fdf4',
        color: '#166534',
        border: '1px solid #bbf7d0',
      }}
    >
      {label}
    </span>
  );
}

function ScoreBar({ score, max = 50 }: { score: number; max?: number }) {
  const pct = Math.min(Math.round((score / max) * 100), 100);
  const color = score >= 30 ? '#10b981' : score >= 15 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div
        style={{
          flex: 1,
          height: '6px',
          borderRadius: '3px',
          backgroundColor: '#e5e7eb',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: color,
            borderRadius: '3px',
            transition: 'width 0.2s',
          }}
        />
      </div>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', minWidth: '2ch' }}>
        {score}
      </span>
    </div>
  );
}

function LeadRow({ lead }: { lead: LeadItem }) {
  return (
    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        <Link href={`/leads/${lead.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#111827' }}>
            {lead.orgName}
          </div>
        </Link>
        {lead.locationNames.length > 0 && (
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '2px' }}>
            📍 {lead.locationNames.slice(0, 2).join(', ')}
          </div>
        )}
      </td>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', minWidth: '140px' }}>
        <ScoreBar score={lead.score} />
      </td>
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        <GateBadge gate={lead.confidenceGate} />
      </td>
      <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
        <FeedbackBadge status={lead.feedbackStatus} />
      </td>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', fontSize: '0.8rem', color: '#6b7280' }}>
        {lead.vacanciesCount > 0 && (
          <span>💼 {lead.vacanciesCount} вакансий</span>
        )}
        {lead.evidenceTitles.length > 0 && (
          <div style={{ marginTop: '4px', fontSize: '0.75rem', lineHeight: 1.3 }}>
            {lead.evidenceTitles.slice(0, 2).join(' · ')}
          </div>
        )}
      </td>
      <td style={{ padding: '12px 16px', verticalAlign: 'top', fontSize: '0.75rem', color: '#9ca3af' }}>
        {new Date(lead.createdAt).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'short',
        })}
      </td>
    </tr>
  );
}

function LeadsTable({ leads }: { leads: LeadItem[] }) {
  if (leads.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '48px 24px',
        color: '#6b7280',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📭</div>
        <p style={{ fontWeight: 500, marginBottom: '4px' }}>Лидов пока нет</p>
        <p style={{ fontSize: '0.85rem' }}>
          Когда дайджест сгенерирует лиды, они появятся здесь.
        </p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Компания
            </th>
            <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Скоринг
            </th>
            <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Gate
            </th>
            <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Статус
            </th>
            <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Доказательства
            </th>
            <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Дата
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ gate?: string; feedback?: string; page?: string }>;
}) {
  const filters = await searchParams;

  // Validate and normalize filter params
  const confidenceGate = filters.gate && ['A', 'B', 'C', 'D'].includes(filters.gate)
    ? filters.gate
    : null;
  const feedbackStatus = filters.feedback || null;

  let profiles: ClientProfile[];
  try {
    profiles = await listClientProfiles();
  } catch {
    profiles = [];
  }

  const activeProfiles = profiles.filter((p) => p.isActive);

  // Fetch leads for each active profile with filters
  const profileLeads = await Promise.all(
    activeProfiles.map(async (profile) => {
      try {
        const result = await getLeadsForProfile({
          clientProfileId: profile.id,
          confidenceGate,
          feedbackStatus,
        });
        return { profile, leads: result.leads, total: result.total };
      } catch {
        return { profile, leads: [], total: 0 };
      }
    }),
  );

  // Flatten all leads for display
  const allLeads = profileLeads.flatMap((pl) => pl.leads);
  const hasFilters = confidenceGate !== null || feedbackStatus !== null;

  return (
    <main style={{ backgroundColor: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 16px' }}>
        {/* Header */}
        <header style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
                🎯 Лиды
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '4px' }}>
                Компании, которым стоит написать сегодня
                {hasFilters && (
                  <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#3b82f6' }}>
                    (фильтр активен)
                  </span>
                )}
              </p>
            </div>
            <nav style={{ display: 'flex', gap: '12px' }}>
              <Link
                href="/dashboard"
                style={{
                  fontSize: '0.875rem',
                  color: '#6b7280',
                  textDecoration: 'none',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                }}
              >
                ← Дашборд
              </Link>
            </nav>
          </div>
        </header>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>Всего лидов</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginTop: '4px' }}>{allLeads.length}</div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>Gate A/B</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
              {allLeads.filter((l) => l.confidenceGate === 'A' || l.confidenceGate === 'B').length}
            </div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>С обратной связью</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6', marginTop: '4px' }}>
              {allLeads.filter((l) => l.feedbackStatus && l.feedbackStatus !== 'none').length}
            </div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>Профилей</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginTop: '4px' }}>{activeProfiles.length}</div>
          </div>
        </div>

        {/* Leads table */}
        <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <Suspense fallback={<div style={{ padding: '32px', textAlign: 'center', color: '#6b7280' }}>Загрузка...</div>}>
            <LeadsFilters />
          </Suspense>
          <Suspense fallback={<div style={{ padding: '32px', textAlign: 'center', color: '#6b7280' }}>Загрузка...</div>}>
            <LeadsTable leads={allLeads} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
