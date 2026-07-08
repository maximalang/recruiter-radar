/**
 * Telegram batch digest builder.
 *
 * Delivery sends ONE coherent digest per run — an executive brief, not a stream
 * of per-lead messages. Each company gets a dense, restrained block: readiness +
 * signal strength, why-now, roles, the reachable corporate surface (career page /
 * site / lawful contact path), and its evidence sources. A deep link opens the
 * full /leads view for the leads that don't fit the text.
 *
 * Splitting: Telegram caps a message at 4096 chars. We pack numbered blocks into
 * at most MAX_BATCH_MESSAGES messages, each ≤ the limit; any lead that would
 * overflow the last message is dropped from the text (still reachable in-app via
 * the footer link). A run with no leads produces no message at all.
 *
 * Tone is deliberately premium and restrained: high signal density, minimal
 * decoration, a single informational glyph only where it aids scanning. It never
 * invents a contact — when a surface is missing it says so plainly.
 *
 * Pure + deterministic: no network here. The caller sends the returned strings.
 */

import { scoreBand, formatSignalStrength } from '@/lib/scoring/score-display'
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality'
import { escapeTelegramHtml as escapeHtml } from './html'

/** Telegram hard limit per message. */
export const TELEGRAM_MESSAGE_CHAR_LIMIT = 4096
/** Max messages a single digest run may fan out to. One coherent digest. */
export const MAX_BATCH_MESSAGES = 2

/** The per-lead shape the batch card reads. */
export interface BatchLead {
  orgId: string
  orgName: string
  score: number | null
  confidenceGate?: string
  vacanciesCount: number
  evidenceTitles: string[]
  locationNames: string[]
  /** Concrete why-now / why-match line, already derived. Optional. */
  whyLine?: string | null
  /**
   * ISO date of the latest hiring signal — feeds the mode-aware urgency cue
   * (freshness recency). Optional; when absent the cue degrades to a count-only
   * read. Mirrors `latest_published_at` on digest_candidates.
   */
  latestPublishedAt?: string | null
  /**
   * Resolved agency hiring mode (never 'auto' — resolve upstream). Drives a
   * mode-aware urgency line so an executive agency does not see volume-shaped
   * "12 вакансий" framing and a volume agency sees hiring-scale emphasis.
   * Optional for backward compat; defaults to specialist (the pre-mode ladder).
   */
  hiringMode?: 'specialist' | 'executive' | 'volume'
  /** Geo gate: foreign employer → restrained marker. */
  isForeignEmployer?: boolean
  /** Reachable corporate surfaces — links are shown when present, never invented. */
  careerPageUrl?: string | null
  orgWebsite?: string | null
  orgDomain?: string | null
  /** Human label for the lawful contact path, when no direct link is available. */
  contactPathLabel?: string | null
  /** Evidence sources (trust line). */
  sourceFamilies?: string[]
}

export interface BatchDigestInput {
  /** Companies for this run, already ordered strongest-first. */
  leads: readonly BatchLead[]
  /** Delivery date, for the header (defaults to now). */
  date?: Date
  /** Absolute /leads deep link, e.g. https://app.example.com/leads. */
  leadsUrl: string
}

function formatDateRu(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date)
}

/** Russian plural for "компания". */
function pluralCompanies(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'компания'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'компании'
  return 'компаний'
}

/**
 * Readiness headline from the confidence gate. A/B are ready to contact, C needs
 * review; D never reaches a lead, so it reads as review too. Mirrors the product
 * contract (CLAUDE.md confidence gates).
 */
function readinessLabel(gate: string | undefined): string {
  switch ((gate ?? '').toUpperCase()) {
    case 'A':
    case 'B':
      return 'Готов к контакту'
    default:
      return 'На проверку'
  }
}

/** Hostname for a URL, for premium link text (no scheme, no trailing slash). */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  }
}

/** Normalize a bare domain to an absolute https URL for an anchor href. */
function domainToUrl(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
}

/**
 * The reachable-surface line. Prefers concrete, clickable links (career page,
 * site); falls back to the lawful-contact-path label; and when nothing is known
 * says so plainly rather than inventing a channel. Returns null only when there
 * is genuinely nothing to show.
 */
function formatContactLine(lead: BatchLead): string | null {
  const parts: string[] = []

  if (lead.careerPageUrl && lead.careerPageUrl.trim()) {
    const url = lead.careerPageUrl.trim()
    parts.push(`<a href="${escapeHtml(url)}">Карьерная страница</a>`)
  }

  const siteUrl = lead.orgWebsite?.trim() || (lead.orgDomain?.trim() ? domainToUrl(lead.orgDomain.trim()) : '')
  if (siteUrl) {
    parts.push(`<a href="${escapeHtml(siteUrl)}">${escapeHtml(hostnameOf(siteUrl))}</a>`)
  }

  if (parts.length > 0) {
    return `Контакт: ${parts.join(' · ')}`
  }

  // No direct surface — fall back to the lawful path label, honestly.
  if (lead.contactPathLabel && lead.contactPathLabel.trim()) {
    return `Контакт: ${escapeHtml(lead.contactPathLabel.trim())}`
  }

  return 'Контакт: прямой путь уточняется'
}

/**
 * Render one numbered lead block (no trailing newline), HTML parse mode.
 *
 *   1. <b>Ромашка</b> · Москва
 *   Готов к контакту · Горячий · сигнал 3.2
 *   Открыли 4 вакансии за неделю
 *   Роли: Backend, DevOps + ещё 2
 *   Контакт: Карьерная страница · romashka.ru
 *   Источники: career-pages, habr
 */
export function formatBatchLeadBlock(lead: BatchLead, index: number): string {
  const band = scoreBand(lead.score)
  // Foreign-employer marker — a quiet textual tag instead of an emoji. Stated
  // plainly so the recruiter knows the signal is on a foreign ATS and RU
  // relevance is lowered, without emoji as the visual system.
  const foreignMark = lead.isForeignEmployer ? ' · зарубежный ATS' : ''
  const location = lead.locationNames[0] ? ` · ${escapeHtml(lead.locationNames[0])}` : ''

  const lines: string[] = []

  // Title: company + region (+ foreign marker only when it aids scanning).
  lines.push(`${index}. <b>${escapeHtml(lead.orgName)}</b>${location}${foreignMark}`)

  // Readiness line — ≤2 confidence readouts: readinessLabel + band + numeric.
  // The gate letter (A/B/C) is encoded in `readinessLabel` («Готов к контакту»
  // for A/B, «На проверку» for C/D), so a bare gate letter would be a third
  // readout of the same fact. One contract shared with the email renderer —
  // see lib/email/digestEmail.ts (T6.1/T6.2 de-duplication).
  lines.push(`${readinessLabel(lead.confidenceGate)} · ${band.label} · сигнал ${formatSignalStrength(lead.score)}`)

  // Why now — only when there is a concrete argument.
  if (lead.whyLine && lead.whyLine.trim()) {
    lines.push(escapeHtml(lead.whyLine.trim()))
  }

  // Mode-aware urgency cue — a one-line read of hiring tempo shaped by the
  // agency's practice type. Executive: freshness/seniority framing (a single
  // fresh posting reads as urgency, raw role count does NOT). Volume:
  // hiring-scale framing. Specialist: the default recency ladder. The cue only
  // restates what is true of the lead (counts + freshness) — it never invents
  // activity, seniority, or a contact. Rendered only when it adds information
  // beyond the whyLine above.
  const urgency = deriveUrgencyCue({
    vacanciesCount: lead.vacanciesCount,
    latestPublishedAt: lead.latestPublishedAt ?? null,
    hiringMode: lead.hiringMode ?? 'specialist',
  })
  if (urgency.label && urgency.label.trim()) {
    lines.push(escapeHtml(urgency.label.trim()))
  }

  // Roles / hiring signal.
  const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles })
  const { shown, more } = splitRolesForDisplay(roleNames, 3)
  if (shown.length > 0) {
    const rolesText = shown.map(escapeHtml).join(', ') + (more > 0 ? ` + ещё ${more}` : '')
    const count = lead.vacanciesCount > 0 ? ` · ${lead.vacanciesCount} вак.` : ''
    lines.push(`Роли: ${rolesText}${count}`)
  }

  // Reachable surface.
  const contact = formatContactLine(lead)
  if (contact) {
    lines.push(contact)
  }

  // Evidence sources (trust).
  if (lead.sourceFamilies && lead.sourceFamilies.length > 0) {
    lines.push(`<i>Источники: ${lead.sourceFamilies.map(escapeHtml).join(', ')}</i>`)
  }

  return lines.join('\n')
}

export interface BatchDigestResult {
  /** 0, 1, or up to MAX_BATCH_MESSAGES message texts. Empty = nothing to send. */
  messages: string[]
  /** How many leads made it into the text (may be < input on overflow). */
  includedLeads: number
  /** Leads dropped from text due to the message cap (still in-app). */
  droppedLeads: number
}

/**
 * Build the batched digest message(s) for a run. Returns [] when there are no
 * leads. Packs numbered blocks into ≤ MAX_BATCH_MESSAGES messages, each ≤ the
 * Telegram char limit; the footer link is appended to the LAST message only.
 */
export function buildBatchDigestMessages(input: BatchDigestInput): BatchDigestResult {
  const leads = input.leads
  if (leads.length === 0) {
    return { messages: [], includedLeads: 0, droppedLeads: 0 }
  }

  const date = input.date ?? new Date()
  const header =
    `<b>Радар · ${formatDateRu(date)}</b>\n${leads.length} ${pluralCompanies(leads.length)} с сигналом найма`
  const footer = `\n\n<a href="${escapeHtml(input.leadsUrl)}">Открыть все лиды →</a>`

  // Greedy pack: fill each message until the next block (plus, on the last
  // message, the footer) would overflow, then spill into the next message.
  const blocks = leads.map((lead, i) => formatBatchLeadBlock(lead, i + 1))

  const messages: string[] = []
  let current = header
  let included = 0

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    const candidate = current === '' ? block : `${current}\n\n${block}`
    // Reserve footer room only when this could be the final message.
    const withFooterLen = candidate.length + footer.length
    if (withFooterLen <= TELEGRAM_MESSAGE_CHAR_LIMIT) {
      current = candidate
      included += 1
      continue
    }
    // Block doesn't fit in the current message. Roll over to a new message if we
    // still have message budget.
    if (messages.length + 1 < MAX_BATCH_MESSAGES) {
      messages.push(current)
      current = block
      included += 1
    } else {
      // No budget for another message — stop packing; remaining leads are dropped
      // from the text but still reachable via the "открыть все" link.
      break
    }
  }

  messages.push(current)
  // Footer goes on the last message only.
  messages[messages.length - 1] = messages[messages.length - 1] + footer

  return {
    messages,
    includedLeads: included,
    droppedLeads: leads.length - included,
  }
}
