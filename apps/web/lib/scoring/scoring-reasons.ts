/**
 * Structured scoring reason — replaces free-form string reasons with
 * typed, localisable reason objects.
 *
 * Each reason has:
 *   - component: which FIUR axis produced it
 *   - key: a stable machine-readable identifier
 *   - params: optional substitution values for the label template
 *
 * The REASON_LABELS map provides Russian label templates for each key.
 * UI and digest rendering should use `formatReason()` to get the
 * user-facing text, never the raw key.
 */

export type FiurComponent = 'fit' | 'intent' | 'urgency' | 'reachability'

export interface ScoringReason {
  component: FiurComponent
  key: string
  params?: Record<string, string | number>
}

/**
 * Russian label templates for scoring reason keys.
 * Use `{paramName}` for substitution from `reason.params`.
 */
export const REASON_LABELS: Record<string, string> = {
  // Fit
  'fit.industry.excluded': 'Индустрия «{industry}» исключена из ICP',
  'fit.industry.match': 'Индустрия «{industry}» совпадает с ICP',
  'fit.industry.match.reweighted': 'Индустрия «{industry}» совпадает с ICP (понижен вес на {penaltyPercent}% из истории «мимо»)',
  'fit.industry.partial': 'Индустрия «{industry}» частично совпадает с ICP',
  'fit.industry.outside': 'Индустрия «{industry}» вне ICP',
  'fit.icp.match': 'Совпадение с вашей специализацией и ключевыми словами ICP',
  'fit.role.match': '{count} ролей совпадает с вашим профилем',
  'fit.role.no-match': 'Нет совпадений по ролям с вашим ICP',
  'fit.location.match': 'Регион совпадает с ICP',
  'fit.location.outside': 'Регион «{location}» вне ICP',
  'fit.size.match': 'Размер компании «{size}» совпадает с ICP',
  'fit.size.smb-sweet-spot': 'SMB sweet spot ({detail}, 50–500 сотрудников) — оптимальный бюджет для агентства',
  'fit.market.boom': 'Высокий рыночный спрос повышает релевантность',
  'fit.market.bust': 'Низкий рыночный спрос снижает релевантность',

  // Intent
  'intent.no-vacancies': 'Нет вакансий — нет сигнала найма',
  'intent.internal-recruiter-only': 'Только вакансия внутреннего рекрутера — не считается сигналом найма по правилам продукта',
  'intent.fresh-signals': 'Свежие сигналы найма (недели давности)',
  'intent.partially-fresh': 'Частично свежие сигналы найма',
  'intent.stale-signals': 'Сигналы найма устарели (старше ~60 дней)',
  'intent.direct-surface': 'Прямая поверхность компании подтверждает вакансию',
  'intent.direct-evidence.corroborated': 'Прямое подтверждение из независимого источника',
  'intent.direct-evidence.present': 'Прямое подтверждение есть',
  'intent.multiple-corroborating': 'Независимые источники подтверждают друг друга',
  'intent.multiple-roles': 'Несколько открытых ролей ({count}) — активный найм',
  'intent.non-tech-mix': 'Non-tech роли ({nonTech}/{total}) — аутсорсинг-вероятные позиции усиливают лид',
  'intent.source-diversity.high': '{count} независимых источников повышают уверенность',
  'intent.source-diversity.medium': '2 независимых источника усиливают сигнал',

  // Urgency
  'urgency.no-vacancies': 'Нет вакансий — нет срочности',
  'urgency.burst': 'Hiring burst: {details}',
  'urgency.hard-to-fill': '{count} дефицитных ролей повышают срочность',
  'urgency.fresh-postings': 'Несколько свежих вакансий за 14 дней',
  'urgency.stale-role-repeated': '{count} повторяющихся ролей без обновления >30 дн. — понижение срочности',
  'urgency.stale-role-single': 'Повторяющаяся роль без обновления >30 дн. — возможна потеря актуальности',
  'urgency.recent-signal-burst': '{count} свежих сигналов найма за 7 дней — активная срочность',

  // Reachability
  'reachability.career-page': 'Карьерная страница доступна — прямой путь к HR',
  'reachability.corporate-contact': 'Корпоративный HR-контакт доступен',
  'reachability.direct-surface': 'Прямая поверхность компании в evidence',
  'reachability.policy-no-corporate': 'Нет корпоративного пути контакта, а политика «{policy}» запрещает личные — путь ограничен',
  'reachability.no-path': 'Безопасный путь контакта пока не найден',
}

/**
 * Format a ScoringReason into a user-facing Russian string.
 * Falls back to `[key]` if no label template exists.
 */
export function formatReason(reason: ScoringReason): string {
  const template = REASON_LABELS[reason.key]
  if (!template) return `[${reason.key}]`

  if (!reason.params) return template

  return template.replace(/\{(\w+)\}/g, (match, paramName) => {
    const value = reason.params?.[paramName]
    return value != null ? String(value) : match
  })
}

/**
 * Format an array of ScoringReasons into Russian strings.
 */
export function formatReasons(reasons: ScoringReason[]): string[] {
  return reasons.map(formatReason)
}
