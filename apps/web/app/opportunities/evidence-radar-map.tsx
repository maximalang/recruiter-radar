'use client'

import { useMemo, useState, type CSSProperties } from 'react'

import type { EvidenceRadarRegionBoundary } from '@/lib/intelligence/evidence-radar-boundaries'
import type { EvidenceRadarLead } from '@/lib/intelligence/evidence-radar-repository'
import styles from './evidence-radar-map.module.css'

const RADAR_WINDOW_DAYS = 30
const MAX_PERSISTENT_LABELS = 8

export function EvidenceRadarMap(props: {
  leads: readonly EvidenceRadarLead[]
  boundaries?: readonly EvidenceRadarRegionBoundary[]
  referenceTimestamp: number
}) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(
    props.leads[0]?.cardId ?? null,
  )
  const selected = props.leads.find((lead) => lead.cardId === selectedCardId) ?? props.leads[0] ?? null
  const rankedLeads = useMemo(() => rankRadarLeads(props.leads), [props.leads])
  const labelledIds = useMemo(
    () => new Set(rankedLeads.slice(0, MAX_PERSISTENT_LABELS).map((lead) => lead.cardId)),
    [rankedLeads],
  )

  if (props.leads.length === 0) {
    return (
      <section className={styles.empty} data-evidence-radar-empty>
        <strong>Подтверждённых сигналов пока нет</strong>
        <p>
          Радар показывает только компании, для которых есть проверяемая цепочка подтверждений.
          Слабые или неподтверждённые связи не дорисовываются.
        </p>
      </section>
    )
  }

  return (
    <div className={styles.layout}>
      <section className={styles.radarPanel} aria-labelledby="evidence-radar-title">
        <header className={styles.radarHeader}>
          <div>
            <span className={styles.radarEyebrow}>Свежесть × уровень подтверждения</span>
            <h2 id="evidence-radar-title">Сильные сигналы ближе к верхнему правому углу</h2>
          </div>
          <div className={styles.radarLegend} aria-label="Как читать Радар">
            <span>по горизонтали — свежесть</span>
            <span>по вертикали — подтверждение</span>
            <span>размер — коммерческая релевантность</span>
          </div>
        </header>

        <p className={styles.selectedStatus} data-motion-status role="status" aria-live="polite">
          {selected ? `Выбрано: ${selected.organizationName}, ${selected.location.city}` : ''}
        </p>

        <div className={styles.canvas} data-evidence-radar-map>
          <div className={styles.axisY} aria-hidden="true">
            <span>сильнее подтверждено</span>
            <span>слабее подтверждено</span>
          </div>
          <div className={styles.axisX} aria-hidden="true">
            <span>старее</span>
            <span>сейчас</span>
          </div>
          <div className={styles.guideHorizontal} aria-hidden="true" />
          <div className={styles.guideVertical} aria-hidden="true" />

          {props.leads.map((lead) => (
            <RadarOrganization
              key={lead.cardId}
              lead={lead}
              selected={lead.cardId === selected?.cardId}
              labelled={labelledIds.has(lead.cardId) || lead.cardId === selected?.cardId}
              onSelect={() => setSelectedCardId(lead.cardId)}
              referenceTimestamp={props.referenceTimestamp}
            />
          ))}
        </div>

        <div className={styles.semanticListWrap}>
          <div className={styles.semanticListHeader}>
            <h3>Сигналы по приоритету</h3>
            <span>{rankedLeads.length} компаний</span>
          </div>
          <ol className={styles.semanticList} aria-label="Компании на Радаре">
            {rankedLeads.map((lead, index) => {
              const confidence = radarConfidence(lead)
              return (
                <li key={lead.cardId} data-selected={lead.cardId === selected?.cardId ? 'true' : undefined}>
                  <button type="button" onClick={() => setSelectedCardId(lead.cardId)}>
                    <span className={styles.semanticRank}>{String(index + 1).padStart(2, '0')}</span>
                    <span className={styles.semanticIdentity}>
                      <strong>{lead.organizationName}</strong>
                      <small>{lead.location.city} · {freshnessLabel(lead, props.referenceTimestamp)}</small>
                    </span>
                    <span className={styles.semanticWhy}>{lead.whyNow}</span>
                    <span className={styles.semanticConfidence} data-level={confidence.level}>
                      {confidence.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <aside className={styles.detailPanel} aria-label="Контекст выбранной компании">
        {selected ? <EvidenceLeadDetail key={selected.cardId} lead={selected} /> : null}
      </aside>
    </div>
  )
}

function RadarOrganization(props: {
  lead: EvidenceRadarLead
  selected: boolean
  labelled: boolean
  onSelect: () => void
  referenceTimestamp: number
}) {
  const point = radarPoint(props.lead, props.referenceTimestamp)
  const relevance = clamp01(props.lead.score.opportunityScore / 100)
  const actualEvidence = props.lead.evidence.slice(0, 3)
  const style = {
    left: `${point.x.toFixed(4)}%`,
    top: `${point.y.toFixed(4)}%`,
    '--relevance': relevance.toFixed(6),
  } as CSSProperties

  return (
    <div
      className={styles.cluster}
      style={style}
      data-selected={props.selected ? 'true' : undefined}
      data-recency={point.recency}
      data-confidence={point.confidence}
    >
      {props.selected && actualEvidence.length > 0 ? (
        <span className={styles.evidenceConstellation} aria-hidden="true">
          {actualEvidence.map((event, index) => {
            const offset = deterministicEvidenceOffset(props.lead.organizationId, index, actualEvidence.length)
            return (
              <i
                key={event.id}
                className={styles.evidencePoint}
                data-evidence-source
                style={{
                  '--evidence-x': `${offset.x}px`,
                  '--evidence-y': `${offset.y}px`,
                } as CSSProperties}
              />
            )
          })}
        </span>
      ) : null}
      <button
        type="button"
        className={styles.organizationMarker}
        data-motion-interactive
        onClick={props.onSelect}
        aria-pressed={props.selected}
        aria-label={`${props.lead.organizationName}, ${props.lead.location.city}`}
      >
        <span className={styles.organizationNode} aria-hidden="true" />
        <span className={styles.markerLabel} data-visible={props.labelled ? 'true' : undefined}>
          <strong>{props.lead.organizationName}</strong>
          <small>{freshnessLabel(props.lead, props.referenceTimestamp)} · {radarConfidence(props.lead).label}</small>
        </span>
      </button>
    </div>
  )
}

function EvidenceLeadDetail({ lead }: { lead: EvidenceRadarLead }) {
  const staffing = lead.staffingNeed
  const functions = stringList(staffing?.functions)
  const professions = stringList(staffing?.professions)
  const decisionMakers = stringList(staffing?.decisionMakerRoles)
  const minHeadcount = numeric(staffing?.minHeadcount)
  const maxHeadcount = numeric(staffing?.maxHeadcount)
  const mode = typeof staffing?.mode === 'string' ? staffing.mode : null
  const acceleration = lead.temporalContext?.strongestAcceleration ?? null
  const confidence = radarConfidence(lead)

  return (
    <article className={styles.leadCard} data-evidence-lead-card>
      <header className={styles.leadHeader}>
        <div>
          <span className={styles.eyebrow}>Компания с подтверждённым сигналом</span>
          <h2>{lead.organizationName}</h2>
          {lead.legalName && lead.legalName !== lead.organizationName ? <p>{lead.legalName}</p> : null}
        </div>
        <div className={styles.leadScore} aria-label={`Сила сигнала ${Math.round(lead.score.leadScore)} из 100`}>
          <strong>{Math.round(lead.score.leadScore)}</strong>
          <span>{confidence.label}</span>
        </div>
      </header>

      <div className={styles.locationLine}>
        <span>{lead.location.city}</span>
        <span>{lead.location.federalSubjectName}</span>
        {lead.location.address ? <span>{lead.location.address}</span> : null}
      </div>

      <section className={styles.leadSection}>
        <h3>Почему сейчас</h3>
        <p>{lead.whyNow}</p>
        {acceleration && acceleration.change > 0 ? (
          <p className={styles.delta}>
            Активные вакансии: {acceleration.previous} → {acceleration.current} за {acceleration.windowDays} дней (+{acceleration.change}).
          </p>
        ) : null}
      </section>

      <section className={styles.leadSection}>
        <div className={styles.sectionHeading}>
          <h3>Подтверждения</h3>
          <span>{lead.independentSourceCount} независимых источника</span>
        </div>
        {lead.evidence.length > 0 ? (
          <ol className={styles.timeline}>
            {lead.evidence.map((event) => (
              <li key={event.id}>
                <span>{formatDate(event.occurredAt)}</span>
                <div>
                  <strong>{evidenceEventLabel(event.eventType)}</strong>
                  <small>{event.sourceFamily} · достоверность {Math.round(event.confidence * 100)}%</small>
                  {event.canonicalUrl ? (
                    <a href={event.canonicalUrl} target="_blank" rel="noreferrer">
                      {event.primarySource ? 'Открыть первичный источник' : 'Открыть источник'}
                    </a>
                  ) : (
                    <em>Прямая ссылка недоступна</em>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.muted}>Датированные подтверждения для этого сигнала пока недоступны.</p>
        )}
      </section>

      {lead.riskReasons.length > 0 ? (
        <section className={styles.leadSection}>
          <h3>Ограничения</h3>
          <ul className={styles.riskList}>{lead.riskReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </section>
      ) : null}

      <section className={styles.leadSection}>
        <h3>Контакт</h3>
        {lead.contactPaths.length > 0 ? (
          <div className={styles.contacts}>
            {lead.contactPaths.map((contact) => contact.href ? (
              <a key={contact.id} href={contact.href} target={contact.href.startsWith('https://') ? '_blank' : undefined} rel={contact.href.startsWith('https://') ? 'noreferrer' : undefined}>
                {contact.label}
              </a>
            ) : <span key={contact.id}>{contact.label}</span>)}
          </div>
        ) : <p className={styles.muted}>Публичный company-level контакт ещё не подтверждён.</p>}
      </section>

      <footer className={styles.nextAction}>
        <span>Следующий ход</span>
        <strong>{lead.recommendedAction}</strong>
        {lead.recommendedContactAt ? <small>Рекомендуемое окно: {formatDate(lead.recommendedContactAt)}</small> : null}
      </footer>

      <details className={styles.diagnostics}>
        <summary>Диагностика оценки</summary>
        <div className={styles.diagnosticsBody}>
          <div className={styles.diagnosticMetrics}>
            <Score label="Коммерческая релевантность" value={lead.score.opportunityScore} />
            <Score label="Подтверждение" value={lead.score.confidenceScore} />
            <Score label="Срочность" value={lead.score.urgencyScore} />
            <Score label="Доступность контакта" value={lead.score.contactabilityScore} />
            <Score label="Риск" value={lead.score.riskScore} risk />
          </div>

          <section className={styles.leadSection}>
            <h3>Предполагаемая кадровая потребность</h3>
            {staffing ? (
              <div className={styles.factStack}>
                {functions.length > 0 ? <p><strong>Функции:</strong> {functions.join(', ')}</p> : null}
                {professions.length > 0 ? <p><strong>Профессии:</strong> {professions.join(', ')}</p> : null}
                {minHeadcount != null && maxHeadcount != null ? (
                  <p><strong>Объём:</strong> {minHeadcount}–{maxHeadcount} · {staffingModeLabel(mode)}</p>
                ) : null}
                {decisionMakers.length > 0 ? <p><strong>Кому писать:</strong> {decisionMakers.join(', ')}</p> : null}
              </div>
            ) : (
              <p className={styles.muted}>Недостаточно подтверждений для прогноза объёма. Значение не синтезируется.</p>
            )}
          </section>

          <section className={styles.leadSection}>
            <h3>Вклад подтверждённых факторов</h3>
            {lead.score.contributions.length > 0 ? (
              <ul className={styles.contributions}>
                {lead.score.contributions.map((item, index) => (
                  <li key={`${item.eventId}:${item.component}:${index}`}>
                    <span>{scoreComponentLabel(item.component)}</span>
                    <strong>{item.delta >= 0 ? '+' : ''}{item.delta}</strong>
                    <small>{contributionReasonLabel(item.reason, item.component)}</small>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.muted}>Детализация вклада отсутствует — сигнал требует проверки.</p>}
          </section>
        </div>
      </details>
    </article>
  )
}

function Score(props: { label: string; value: number; risk?: boolean }) {
  return (
    <div className={styles.scoreItem} data-risk={props.risk ? 'true' : undefined}>
      <span>{props.label}</span>
      <strong>{Math.round(props.value)}</strong>
    </div>
  )
}

const EVIDENCE_EVENT_LABELS: Readonly<Record<string, string>> = {
  hiring_growth: 'Рост найма',
  funding_received: 'Получено финансирование',
  vacancy_opened: 'Открыта вакансия',
  vacancy_republished: 'Вакансия опубликована повторно',
  leadership_hire: 'Открыта руководящая роль',
}

const SCORE_COMPONENT_LABELS: Readonly<Record<string, string>> = {
  opportunity: 'Коммерческая релевантность',
  confidence: 'Подтверждение',
  urgency: 'Срочность',
  contactability: 'Доступность контакта',
  risk: 'Риск',
  hiring_intent: 'Интенсивность найма',
  hiringIntent: 'Интенсивность найма',
  freshness: 'Свежесть сигнала',
}

function evidenceEventLabel(value: string): string {
  return EVIDENCE_EVENT_LABELS[value] ?? 'Подтверждённое изменение в найме'
}

function scoreComponentLabel(value: string): string {
  return SCORE_COMPONENT_LABELS[value] ?? 'Подтверждённый фактор'
}

function contributionReasonLabel(reason: string, component: string): string {
  const normalized = reason.trim().toLowerCase()
  if (normalized === 'verified company hiring growth') return 'Подтверждён рост найма в компании'
  if (normalized === 'verified company funding evidence') return 'Финансирование подтверждено источником'
  return `Вклад в показатель «${scoreComponentLabel(component)}» подтверждён доказательством`
}

function staffingModeLabel(mode: string | null): string {
  if (mode === 'targeted') return 'точечный найм'
  if (mode === 'volume') return 'массовый найм'
  return 'режим не указан'
}

function rankRadarLeads(leads: readonly EvidenceRadarLead[]): EvidenceRadarLead[] {
  return [...leads].sort((left, right) => {
    const relevance = right.score.opportunityScore - left.score.opportunityScore
    if (relevance !== 0) return relevance
    const confidence = right.score.confidenceScore - left.score.confidenceScore
    if (confidence !== 0) return confidence
    return latestEvidenceTimestamp(right) - latestEvidenceTimestamp(left)
  })
}

function radarPoint(lead: EvidenceRadarLead, referenceTimestamp: number) {
  const timestamp = latestEvidenceTimestamp(lead)
  const ageDays = timestamp > 0 ? Math.max(0, (referenceTimestamp - timestamp) / 86_400_000) : RADAR_WINDOW_DAYS
  const recency = clamp01(1 - ageDays / RADAR_WINDOW_DAYS)
  const confidence = clamp01(lead.score.confidenceScore / 100)
  return {
    x: 8 + recency * 84,
    y: 88 - confidence * 76,
    recency: Math.round(recency * 100),
    confidence: Math.round(confidence * 100),
  }
}

function latestEvidenceTimestamp(lead: EvidenceRadarLead): number {
  let latest = 0
  for (const event of lead.evidence) {
    const timestamp = Date.parse(event.occurredAt)
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp
  }
  return latest
}

function freshnessLabel(lead: EvidenceRadarLead, referenceTimestamp: number): string {
  const timestamp = latestEvidenceTimestamp(lead)
  if (!timestamp) return 'дата подтверждения не определена'
  const ageHours = Math.max(0, (referenceTimestamp - timestamp) / 3_600_000)
  if (ageHours < 24) return ageHours < 1 ? 'подтверждено недавно' : `${Math.floor(ageHours)} ч назад`
  const ageDays = Math.floor(ageHours / 24)
  if (ageDays === 1) return 'вчера'
  if (ageDays <= 30) return `${ageDays} дн. назад`
  return formatDate(new Date(timestamp).toISOString())
}

function radarConfidence(lead: EvidenceRadarLead): { level: 'high' | 'medium' | 'low'; label: string } {
  const value = lead.score.confidenceScore
  if (value >= 75) return { level: 'high', label: 'высокое подтверждение' }
  if (value >= 50) return { level: 'medium', label: 'достаточное подтверждение' }
  return { level: 'low', label: 'требует проверки' }
}

function deterministicEvidenceOffset(seedValue: string, index: number, count: number) {
  const seed = [...seedValue].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 3600, 17)
  const angle = ((seed / 10) + (360 / Math.max(count, 1)) * index) * Math.PI / 180
  const radius = 24 + ((seed + index * 7) % 8)
  return {
    x: Math.round(Math.cos(angle) * radius * 10) / 10,
    y: Math.round(Math.sin(angle) * radius * .72 * 10) / 10,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'дата не подтверждена' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}
