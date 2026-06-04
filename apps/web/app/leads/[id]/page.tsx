import { Suspense } from 'react';
import Link from 'next/link';
import { getLeadDetail } from '@/lib/leads-data';

export const dynamic = 'force-dynamic';

const GATE_CONFIG: Record<string, { color: string; bg: string; label: string; desc: string }> = {
  A: { color: '#065f46', bg: '#d1fae5', label: 'Авто (A)', desc: '2+ независимых источника, чистое совпадение сущности' },
  B: { color: '#1e40af', bg: '#dbeafe', label: 'Авто с меткой (B)', desc: '1 сильный источник + обогащение' },
  C: { color: '#92400e', bg: '#fef3c7', label: 'На проверке (C)', desc: 'Только платформенная агрегация, требует ревью' },
  D: { color: '#4b5563', bg: '#f3f4f6', label: 'Не доставлять (D)', desc: 'Контекст без прямого доказательства найма' },
};

const FEEDBACK_LABELS: Record<string, { label: string; icon: string }> = {
  accepted: { label: 'Беру', icon: '✅' },
  dismissed: { label: 'Мимо', icon: '👋' },
  later: { label: 'Позже', icon: '⏰' },
  contacted: { label: 'Уже написал', icon: '✉️' },
  replied: { label: 'Ответили', icon: '💬' },
  call: { label: 'Созвон', icon: '📞' },
  client: { label: 'Клиент', icon: '🤝' },
  badfit: { label: 'Не подходит', icon: '❌' },
};

function ScoreGauge({ score }: { score: number }) {
  const max = 50;
  const pct = Math.min(Math.round((score / max) * 100), 100);
  const color = score >= 30 ? '#10b981' : score >= 15 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <div style={{
        width: '80px', height: '80px', borderRadius: '50%',
        border: `4px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem', fontWeight: 700, color,
      }}>
        {score}
      </div>
      <div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>Скоринг</div>
        <div style={{ fontSize: '0.85rem', color }}>
          {score >= 30 ? 'Высокий' : score >= 15 ? 'Средний' : 'Низкий'}
        </div>
        <div style={{ marginTop: '4px', width: '120px', height: '4px', borderRadius: '2px', backgroundColor: '#e5e7eb', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '2px' }} />
        </div>
      </div>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLeadDetail({ candidateId: id });

  if (!lead) {
    return (
      <main style={{ backgroundColor: '#f9fafb', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔍</div>
          <p style={{ fontWeight: 500 }}>Лид не найден</p>
          <Link href="/leads" style={{ color: '#3b82f6', fontSize: '0.875rem', marginTop: '8px', display: 'inline-block' }}>
            ← Назад к списку лидов
          </Link>
        </div>
      </main>
    );
  }

  const gate = GATE_CONFIG[lead.confidenceGate] ?? GATE_CONFIG.D;
  const feedback = lead.feedbackStatus && lead.feedbackStatus !== 'none'
    ? FEEDBACK_LABELS[lead.feedbackStatus] ?? { label: lead.feedbackStatus, icon: '❓' }
    : null;

  return (
    <main style={{ backgroundColor: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '32px 16px' }}>
        {/* Header */}
        <header style={{ marginBottom: '32px' }}>
          <Link href="/leads" style={{ fontSize: '0.875rem', color: '#6b7280', textDecoration: 'none' }}>
            ← Лиды
          </Link>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginTop: '8px' }}>
            {lead.orgName}
          </h1>
          {lead.locationNames.length > 0 && (
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '4px' }}>
              📍 {lead.locationNames.join(', ')}
            </p>
          )}
        </header>

        {/* Main content */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px' }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Reasons card */}
            <section style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                🎯 Почему сейчас
              </h2>
              {lead.reasons.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {lead.reasons.map((reason, i) => (
                    <li key={i} style={{
                      padding: '8px 0',
                      borderBottom: i < lead.reasons.length - 1 ? '1px solid #f3f4f6' : 'none',
                      fontSize: '0.9rem',
                      color: '#111827',
                    }}>
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Причины не указаны</p>
              )}
            </section>

            {/* Evidence card */}
            <section style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                📋 Доказательства
              </h2>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {lead.evidenceTitles.length > 0 ? lead.evidenceTitles.map((title, i) => (
                  <span key={i} style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    backgroundColor: '#f0f9ff',
                    color: '#1e40af',
                    border: '1px solid #bfdbfe',
                  }}>
                    {title}
                  </span>
                )) : (
                  <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Нет данных о вакансиях</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: '#6b7280' }}>
                <span>💼 {lead.vacanciesCount} вакансий</span>
                <span>🔀 {lead.distinctVacancyNamesCount} разных ролей</span>
                {lead.latestPublishedAt && (
                  <span>📅 Последняя: {new Date(lead.latestPublishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
                )}
              </div>
            </section>

            {/* Opener card */}
            <section style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                💬 Текст первого сообщения
              </h2>
              <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: '#374151', whiteSpace: 'pre-wrap' }}>
                {lead.opener}
              </p>
            </section>
          </div>

          {/* Right column — sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Score */}
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <ScoreGauge score={lead.score} />
            </div>

            {/* Confidence gate */}
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Уровень доверия</div>
              <span style={{
                display: 'inline-block',
                padding: '4px 12px',
                borderRadius: '9999px',
                fontSize: '0.85rem',
                fontWeight: 600,
                backgroundColor: gate.bg,
                color: gate.color,
              }}>
                {gate.label}
              </span>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '8px', lineHeight: 1.4 }}>
                {gate.desc}
              </p>
            </div>

            {/* Feedback status */}
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Обратная связь</div>
              {feedback ? (
                <div style={{ fontSize: '0.9rem', color: '#111827' }}>
                  {feedback.icon} {feedback.label}
                </div>
              ) : (
                <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Ещё нет обратной связи</div>
              )}
              {lead.feedbackNote && (
                <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '8px', fontStyle: 'italic' }}>
                  {lead.feedbackNote}
                </p>
              )}
            </div>

            {/* Sources */}
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Источники</div>
              {lead.sourceFamilies.length > 0 ? (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {lead.sourceFamilies.map((src) => (
                    <span key={src} style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                    }}>
                      {src}
                    </span>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Нет данных</span>
              )}
            </div>

            {/* Company info */}
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Компания</div>
              {lead.orgWebsite && (
                <a
                  href={lead.orgWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.85rem', color: '#3b82f6', textDecoration: 'none', display: 'block', marginBottom: '4px' }}
                >
                  🌐 Сайт компании →
                </a>
              )}
              {lead.sourceExternalId && (
                <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                  ID: {lead.sourceExternalId}
                </div>
              )}
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '4px' }}>
                Добавлен: {new Date(lead.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
