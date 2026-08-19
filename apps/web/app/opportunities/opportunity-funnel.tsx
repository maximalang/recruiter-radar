import type { OutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'
import {
  isCommercialOutcomeEvent,
  isOutcomeEventType,
} from '@/lib/opportunities/outcome-domain'

import styles from './opportunity-funnel.module.css'

const COMMERCIAL_LIFECYCLE_EVENTS = new Set([
  'meeting_completed',
  'meeting_cancelled',
  'meeting_no_show',
])

export function OpportunityFunnel(props: { summary: OutcomeFunnelSummary }) {
  const hasCommercialData =
    props.summary.effectiveActivityCounts.some((item) => {
      if (item.eventCount <= 0 && item.opportunityCount <= 0) return false
      if (!isOutcomeEventType(item.eventType)) return false
      return isCommercialOutcomeEvent(item.eventType) ||
        COMMERCIAL_LIFECYCLE_EVENTS.has(item.eventType)
    }) ||
    props.summary.terminalOutcomes.completed > 0

  return (
    <section className={styles.funnel} aria-labelledby="outcome-funnel-title">
      <div className={styles.funnelHeading}>
        <div>
          <span>Базовая воронка</span>
          <h2 id="outcome-funnel-title">Коммерческие результаты</h2>
        </div>
        <small>
          Когорта: первое эффективное {props.summary.cohort.eventType === 'shown'
            ? 'появление'
            : 'взятие в работу'} за всю историю ·{' '}
          {props.summary.cohort.size} компаний
        </small>
      </div>
      {hasCommercialData ? (
        <>
          <p>
            Наблюдение: {props.summary.cohort.observationWindowDays} дн. ·{' '}
            {props.summary.cohort.matured
              ? 'Когорта зрелая'
              : 'Незрелая когорта'}
          </p>
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
            {props.summary.effectiveActivityCounts.map((item) =>
              `${item.label} ${item.eventCount} ${plural(
                item.eventCount,
                'раз',
                'раза',
                'раз',
              )} · ${item.opportunityCount} ${plural(
                item.opportunityCount,
                'ситуация',
                'ситуации',
                'ситуаций',
              )}`).join(' · ') ||
              'событий нет'}
          </p>
          <div className={styles.funnelConversions}>
            {props.summary.conversions.map((conversion) => (
              <div key={`${conversion.from}:${conversion.to}`}>
                <span>
                  {label(props.summary, conversion.from)} →{' '}
                  {label(props.summary, conversion.to)}
                </span>
                {conversion.sampleStatus === 'ready' &&
                conversion.rate !== null ? (
                  <strong>{Math.round(conversion.rate * 100)}%</strong>
                ) : (
                  <strong>Недостаточно данных</strong>
                )}
                <small>
                  {conversion.converted} из {conversion.sampleSize}
                  {conversion.maturityStatus === 'immature'
                    ? ' · незрелая когорта'
                    : ''}
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
              <small>
                Считаются только эффективные выигрыши и потери; отменённые исходы исключены.
              </small>
            </div>
          </div>
        </>
      ) : (
        <p className={styles.funnelEmpty}>
          Конверсии появятся после первого коммерческого действия по ситуации.
        </p>
      )}
    </section>
  )
}

function plural(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const absolute = Math.abs(count) % 100
  const last = absolute % 10
  if (absolute > 10 && absolute < 20) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
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
