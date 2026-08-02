import type { OpportunityItem } from '@/lib/opportunities/repository'
import styles from './opportunities.module.css'

export function OpportunityEvidenceSection(props: { opportunity: OpportunityItem }) {
  const opportunity = props.opportunity
  const headingId = `evidence-${opportunity.id}`

  return (
    <section className={styles.evidenceSection} aria-labelledby={headingId}>
      <div className={styles.sectionHeading}>
        <h3 id={headingId}>Доказательства</h3>
        <span>
          {formatDate(opportunity.episodeStartedAt)} —{' '}
          {formatDate(opportunity.episodeLastSeenAt)}
        </span>
      </div>
      {opportunity.evidenceTimeline.length > 0 ? (
        <ol className={styles.timeline}>
          {opportunity.evidenceTimeline.map((item) => {
            const safeUrl = safeEvidenceUrl(item.url)
            return (
              <li key={`${item.kind}:${item.id}`} className={styles.timelineItem}>
                <span className={styles.timelineDot} aria-hidden="true" />
                <div>
                  <span className={styles.timelineDate}>{formatDate(item.occurredAt)}</span>
                  {safeUrl ? (
                    <a href={safeUrl} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                  ) : (
                    <strong>{item.title}</strong>
                  )}
                  <small>
                    {item.source}
                    {item.tier ? ` · ${tierLabel(item.tier)}` : ''}
                  </small>
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className={styles.evidenceFallback}>
          Источники связаны с эпизодом, но их публичное представление пока недоступно.
        </p>
      )}
    </section>
  )
}

function formatDate(value: string | null): string {
  if (!value) return 'без срока'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'дата не указана'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp))
}

function safeEvidenceUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function tierLabel(value: string): string {
  if (value === 'direct') return 'прямое подтверждение'
  if (value === 'corroboration') return 'подтверждение'
  return 'контекст'
}
