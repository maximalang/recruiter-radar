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
        <small>
          Когорта: первое {props.summary.cohort.eventType === 'shown'
            ? 'появление'
            : 'взятие в работу'} за период · {props.summary.cohort.size} компаний
        </small>
      </div>
      <div className={styles.funnelStages}>
        {props.summary.cohortCounts.map((stage) => (
          <div key={stage.eventType}>
            <span>{stage.label}</span>
            <strong>{stage.count}</strong>
          </div>
        ))}
      </div>
      <p>
        Активность за период:{' '}
        {props.summary.activityCounts.map((item) =>
          `${item.label.toLocaleLowerCase('ru-RU')} — ${item.count}`).join(' · ') ||
          'событий нет'}
      </p>
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
      <div className={styles.funnelConversions}>
        <div>
          <span>Завершённые циклы: выиграно / потеряно</span>
          {props.summary.terminalOutcomes.status === 'ready' &&
          props.summary.terminalOutcomes.winRate !== null ? (
            <strong>
              {Math.round(props.summary.terminalOutcomes.winRate * 100)}% побед
            </strong>
          ) : (
            <strong>Недостаточно данных</strong>
          )}
          <small>
            {props.summary.terminalOutcomes.won} /{' '}
            {props.summary.terminalOutcomes.lost} из{' '}
            {props.summary.terminalOutcomes.completed} завершённых
          </small>
        </div>
      </div>
    </section>
  )
}

function label(summary: OutcomeFunnelSummary, eventType: string): string {
  return summary.cohortCounts.find((stage) =>
    stage.eventType === eventType)?.label ??
    eventType
}

function formatHours(hours: number): string {
  if (hours < 24) return `${hours.toLocaleString('ru-RU')} ч`
  return `${(hours / 24).toLocaleString('ru-RU', {
    maximumFractionDigits: 1,
  })} дн.`
}
