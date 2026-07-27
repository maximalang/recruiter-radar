import type { OutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'

import styles from './opportunities.module.css'

export function OpportunityFunnel(props: { summary: OutcomeFunnelSummary }) {
  return (
    <section className={styles.funnel} aria-labelledby="outcome-funnel-title">
      <div className={styles.funnelHeading}>
        <div>
          <span>Базовая воронка</span>
          <h2 id="outcome-funnel-title">Коммерческие результаты</h2>
        </div>
        <small>Последние 30 дней · только данные вашего агентства</small>
      </div>
      <div className={styles.funnelStages}>
        {props.summary.stages.map((stage) => (
          <div key={stage.eventType}>
            <span>{stage.label}</span>
            <strong>{stage.count}</strong>
          </div>
        ))}
      </div>
      <div className={styles.funnelConversions}>
        {props.summary.conversions.map((conversion) => (
          <div key={`${conversion.from}:${conversion.to}`}>
            <span>
              {label(props.summary, conversion.from)} →{' '}
              {label(props.summary, conversion.to)}
            </span>
            {conversion.status === 'ready' && conversion.rate !== null ? (
              <strong>{Math.round(conversion.rate * 100)}%</strong>
            ) : (
              <strong>Недостаточно данных</strong>
            )}
            <small>
              {conversion.converted} из {conversion.sampleSize}
              {conversion.medianHours !== null
                ? ` · медиана ${formatHours(conversion.medianHours)}`
                : ''}
            </small>
          </div>
        ))}
      </div>
    </section>
  )
}

function label(summary: OutcomeFunnelSummary, eventType: string): string {
  return summary.stages.find((stage) => stage.eventType === eventType)?.label ??
    eventType
}

function formatHours(hours: number): string {
  if (hours < 24) return `${hours.toLocaleString('ru-RU')} ч`
  return `${(hours / 24).toLocaleString('ru-RU', {
    maximumFractionDigits: 1,
  })} дн.`
}
