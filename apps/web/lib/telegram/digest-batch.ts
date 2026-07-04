/**
 * Telegram batch digest builder (Block 5).
 *
 * The old delivery sent one Telegram message per lead — noisy for the recruiter
 * and rate-limit-heavy. This builds ONE digest message per run: a numbered list
 * of companies with the essentials (score band, roles, one-line why), plus a
 * deep link to the full /leads view.
 *
 * Splitting: Telegram caps a message at 4096 chars. We pack numbered blocks into
 * at most 2 messages; any lead that would overflow the second message is dropped
 * from the text (the "открыть все" link still surfaces it in-app). A run with no
 * leads produces no message at all.
 *
 * Pure + deterministic: no network here. The caller sends the returned strings.
 */

import { scoreBand } from '@/lib/scoring/score-display'
import { deriveRoleNames, splitRolesForDisplay } from '@/lib/leads/lead-quality'
import { escapeTelegramHtml as escapeHtml } from './html'

/** Telegram hard limit per message. */
export const TELEGRAM_MESSAGE_CHAR_LIMIT = 4096
/** Max messages a single digest run may fan out to. */
export const MAX_BATCH_MESSAGES = 2

/** The minimal per-lead shape the batch card reads. */
export interface BatchLead {
  orgId: string
  orgName: string
  score: number | null
  confidenceGate?: string
  vacanciesCount: number
  evidenceTitles: string[]
  locationNames: string[]
  /** Concrete why-match / why-now line, already derived. Optional. */
  whyLine?: string | null
  /** Geo gate: foreign employer → 🌍 marker. */
  isForeignEmployer?: boolean
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

/** Russian verb agreement for "ищет/ищут". */
function verbHire(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  return mod10 === 1 && mod100 !== 11 ? 'ищет специалистов' : 'ищут специалистов'
}

/**
 * Render one numbered lead block (no trailing newline). Escaped for HTML mode.
 * Example:
 *   1. 🔥 <b>Ромашка</b> · Москва 🌍
 *      Роли: Backend, DevOps + ещё 2
 *      Высокий интерес · нанимают по вашему профилю
 */
export function formatBatchLeadBlock(lead: BatchLead, index: number): string {
  const band = scoreBand(lead.score)
  const foreignMark = lead.isForeignEmployer ? ' 🌍' : ''
  const location = lead.locationNames[0] ? ` · ${escapeHtml(lead.locationNames[0])}` : ''

  const lines: string[] = []
  lines.push(`${index}. ${band.icon} <b>${escapeHtml(lead.orgName)}</b>${location}${foreignMark}`)

  const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles })
  const { shown, more } = splitRolesForDisplay(roleNames, 3)
  if (shown.length > 0) {
    const rolesText = shown.map(escapeHtml).join(', ') + (more > 0 ? ` + ещё ${more}` : '')
    lines.push(`   Роли: ${rolesText}`)
  } else {
    lines.push(`   Роли: не определены`)
  }

  const why = lead.whyLine && lead.whyLine.trim()
    ? `${band.label} интерес · ${escapeHtml(lead.whyLine.trim())}`
    : `${band.label} интерес`
  lines.push(`   ${why}`)

  return lines.join('\n')
}

export interface BatchDigestResult {
  /** 0, 1, or 2 message texts. Empty array = nothing to send. */
  messages: string[]
  /** How many leads made it into the text (may be < input on overflow). */
  includedLeads: number
  /** Leads dropped from text due to the 2-message cap (still in-app). */
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
    `📋 <b>Радар на ${formatDateRu(date)}</b>: ${leads.length} ${pluralCompanies(leads.length)} ${verbHire(leads.length)}`
  const footer = `\n\n<a href="${escapeHtml(input.leadsUrl)}">Открыть все лиды →</a>`

  // Greedy pack: fill message 1 until the next block (plus, on the last message,
  // the footer) would overflow, then spill into message 2. Stop at MAX messages.
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
