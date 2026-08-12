'use client'

import { useMemo, useState, type CSSProperties } from 'react'

import { projectRussianCoordinates } from '@/lib/intelligence/evidence-radar'
import type { EvidenceRadarRegionBoundary } from '@/lib/intelligence/evidence-radar-boundaries'
import type { EvidenceRadarLead } from '@/lib/intelligence/evidence-radar-repository'
import styles from './evidence-radar-map.module.css'

export function EvidenceRadarMap(props: {
  leads: readonly EvidenceRadarLead[]
  boundaries?: readonly EvidenceRadarRegionBoundary[]
}) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(
    props.leads[0]?.cardId ?? null,
  )
  const selected = props.leads.find((lead) => lead.cardId === selectedCardId) ?? props.leads[0] ?? null
  const regions = useMemo(() => buildRegionSummaries(props.leads), [props.leads])

  if (props.leads.length === 0) {
    return (
      <section className={styles.empty} data-evidence-radar-empty>
        <strong>Нет лидов с подтверждённой географией</strong>
        <p>
          Карта спроса не размещает случайные города. Маркер появляется только после
          подтверждения организации, объекта присутствия, координат и доказательной цепочки.
        </p>
      </section>
    )
  }

  return (
    <div className={styles.layout}>
      <section className={styles.radarPanel} aria-label="Карта подтверждённого кадрового спроса">
        <div className={styles.legend} aria-label="Легенда карты">
          <span><i className={styles.legendSource} /> независимый источник</span>
          <span><i className={styles.legendOrganization} /> организация</span>
          <span>яркость — свежесть</span>
          <span>размер — интенсивность найма</span>
          <span>прозрачность — достоверность</span>
        </div>
        <p className={styles.selectedStatus} role="status" aria-live="polite" data-motion-status>
          {selected ? `Выбрано: ${selected.organizationName}, ${selected.location.city}` : ''}
        </p>

        <div className={styles.map} data-evidence-radar-map>
          {props.boundaries && props.boundaries.length > 0 ? (
            <svg
              className={styles.regionBoundaries}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-label="Верифицированные границы субъектов Российской Федерации"
            >
              {props.boundaries.flatMap((boundary) =>
                geometryPaths(boundary.geometry).map((path, index) => (
                  <path
                    key={`${boundary.code}:${index}`}
                    d={path}
                    className={styles.boundaryPath}
                    data-region-code={boundary.code}
                    aria-label={boundary.name}
                  />
                )),
              )}
            </svg>
          ) : (
            <div className={styles.mapFrame} aria-label="Границы субъектов ещё не загружены из верифицированного источника" />
          )}
          {props.leads.map((lead) => (
            <OrganizationCluster
              key={lead.cardId}
              lead={lead}
              selected={lead.cardId === selected?.cardId}
              onSelect={() => setSelectedCardId(lead.cardId)}
            />
          ))}
        </div>

        <div className={styles.regionGrid} aria-label="Региональное покрытие">
          {regions.map((region) => (
            <article key={region.code} className={styles.regionCard}>
              <div>
                <strong>{region.name}</strong>
                <span>{region.cities.join(' · ')}</span>
              </div>
              <dl>
                <div><dt>Организации</dt><dd>{region.organizations}</dd></div>
                <div><dt>Источники</dt><dd>{region.sources}</dd></div>
                <div><dt>Интенсивность</dt><dd>{Math.round(region.hiringIntent * 100)}</dd></div>
                <div><dt>Свежесть</dt><dd>{Math.round(region.freshness * 100)}</dd></div>
              </dl>
              <small>{region.specializations.join(', ')}</small>
            </article>
          ))}
        </div>
      </section>

      <aside className={styles.detailPanel} aria-label="Детали выбранной организации">
        {selected ? <EvidenceLeadDetail key={selected.cardId} lead={selected} /> : null}
      </aside>
    </div>
  )
}

function OrganizationCluster(props: {
  lead: EvidenceRadarLead
  selected: boolean
  onSelect: () => void
}) {
  const point = projectRussianCoordinates(
    props.lead.location.latitude,
    props.lead.location.longitude,
  )
  const freshness = componentValue(props.lead.score.components, 'freshness', .5)
  const intent = componentValue(props.lead.score.components, 'hiringIntent',
    componentValue(props.lead.score.components, 'hiring_intent', props.lead.score.opportunityScore / 100))
  const style = {
    left: `${point.x}%`,
    top: `${point.y}%`,
    '--intent': intent,
    '--freshness': freshness,
    '--confidence': clamp01(props.lead.location.confidence),
    '--risk': clamp01(props.lead.score.riskScore / 100),
  } as CSSProperties
  const sourceCount = Math.min(12, Math.max(1, props.lead.independentSourceCount))

  return (
    <div className={styles.cluster} style={style} data-selected={props.selected ? 'true' : undefined}>
      <div className={styles.sourceOrbit} aria-hidden="true">
        {Array.from({ length: sourceCount }, (_, index) => {
          const offset = deterministicOrbit(props.lead.organizationId, index, sourceCount)
          return (
            <i
              key={`${props.lead.cardId}:source:${index}`}
              className={styles.sourceDot}
              data-evidence-source
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                '--source-index': index,
              } as CSSProperties}
            />
          )
        })}
      </div>
      <button
        type="button"
        className={styles.organizationMarker}
        onClick={props.onSelect}
        data-motion-interactive
        aria-pressed={props.selected}
        aria-label={`${props.lead.organizationName}, ${props.lead.location.city}`}
      >
        <span className={styles.organizationDiamond} aria-hidden="true" />
        <span className={styles.markerLabel}>
          <strong>{props.lead.organizationName}</strong>
          <small>{props.lead.location.city} · {Math.round(props.lead.score.leadScore)}</small>
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

  return (
    <article className={styles.leadCard} data-evidence-lead-card data-motion-disclosure>
      <header className={styles.leadHeader}>
        <div>
          <span className={styles.eyebrow}>Подтверждённая возможность</span>
          <h2>{lead.organizationName}</h2>
          {lead.legalName && lead.legalName !== lead.organizationName ? <p>{lead.legalName}</p> : null}
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
      </section>

      <section className={styles.opportunityStrength} aria-label="Сила возможности">
        <div>
          <span>Сила возможности</span>
          <strong>{Math.round(lead.score.leadScore)} из 100</strong>
        </div>
        <p>Приоритет для проверки и первого контакта по подтверждённым фактам.</p>
      </section>

      <section className={styles.leadSection}>
        <div className={styles.sectionHeading}>
          <h3>Доказательства</h3>
          <span>{lead.independentSourceCount} независимых источника</span>
        </div>
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
      </section>

      {lead.riskReasons.length > 0 ? (
        <section className={styles.leadSection}>
          <h3>Риски</h3>
          <ul className={styles.riskList}>{lead.riskReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </section>
      ) : null}

      <section className={styles.leadSection}>
        <h3>Безопасный путь контакта</h3>
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
        <span>Следующий шаг</span>
        <strong>{lead.recommendedAction}</strong>
        {lead.recommendedContactAt ? <small>Рекомендуемое окно: {formatDate(lead.recommendedContactAt)}</small> : null}
      </footer>

      <details className={styles.diagnostics}>
        <summary>Диагностика оценки</summary>
        <div className={styles.diagnosticsBody}>
          <div className={styles.scoreGrid}>
            <Score label="Сила возможности" value={lead.score.opportunityScore} />
            <Score label="Достоверность" value={lead.score.confidenceScore} />
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
            ) : <p className={styles.muted}>Детализация вклада отсутствует — карточка требует проверки.</p>}
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
  opportunity: 'Сила возможности',
  confidence: 'Достоверность',
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

function buildRegionSummaries(leads: readonly EvidenceRadarLead[]) {
  const regions = new Map<string, {
    code: string
    name: string
    cities: Set<string>
    organizations: Set<string>
    sources: number
    intent: number[]
    freshness: number[]
    specializations: Set<string>
  }>()

  for (const lead of leads) {
    const key = lead.location.federalSubjectCode
    const current = regions.get(key) ?? {
      code: key,
      name: lead.location.federalSubjectName,
      cities: new Set<string>(),
      organizations: new Set<string>(),
      sources: 0,
      intent: [],
      freshness: [],
      specializations: new Set<string>(),
    }
    current.cities.add(lead.location.city)
    current.organizations.add(lead.organizationId)
    current.sources += lead.independentSourceCount
    current.intent.push(componentValue(lead.score.components, 'hiringIntent',
      componentValue(lead.score.components, 'hiring_intent', lead.score.opportunityScore / 100)))
    current.freshness.push(componentValue(lead.score.components, 'freshness', .5))
    if (lead.specialization) current.specializations.add(lead.specialization)
    regions.set(key, current)
  }

  return [...regions.values()]
    .map((region) => ({
      code: region.code,
      name: region.name,
      cities: [...region.cities].sort(),
      organizations: region.organizations.size,
      sources: region.sources,
      hiringIntent: average(region.intent),
      freshness: average(region.freshness),
      specializations: [...region.specializations].sort(),
    }))
    .sort((a, b) => b.organizations - a.organizations || a.name.localeCompare(b.name, 'ru'))
}

function deterministicOrbit(seedValue: string, index: number, count: number) {
  const seed = [...seedValue].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 3600, 17)
  const angle = ((seed / 10) + (360 / count) * index) * Math.PI / 180
  const radius = 18 + ((seed + index * 7) % 11)
  return {
    x: Math.round(Math.cos(angle) * radius * 10) / 10,
    y: Math.round(Math.sin(angle) * radius * .68 * 10) / 10,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function average(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function componentValue(values: Record<string, number>, key: string, fallback: number): number {
  const value = values[key]
  return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : clamp01(fallback)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'дата не подтверждена' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function geometryPaths(geometry: Readonly<Record<string, unknown>>): string[] {
  const type = geometry.type
  const coordinates = geometry.coordinates
  if (!Array.isArray(coordinates)) return []
  if (type === 'Polygon') return polygonPaths(coordinates)
  if (type === 'MultiPolygon') {
    return coordinates.flatMap((polygon) => Array.isArray(polygon) ? polygonPaths(polygon) : [])
  }
  return []
}

function polygonPaths(rings: unknown[]): string[] {
  return rings.flatMap((ring) => {
    if (!Array.isArray(ring)) return []
    const points = ring.flatMap((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return []
      const longitude = pair[0]
      const latitude = pair[1]
      if (typeof longitude !== 'number' || typeof latitude !== 'number') return []
      try {
        return [projectRussianCoordinates(latitude, longitude)]
      } catch {
        return []
      }
    })
    if (points.length < 3) return []
    return [`M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`]
  })
}
