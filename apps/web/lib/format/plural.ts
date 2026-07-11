/**
 * Russian pluralization helpers — single source of truth so delivery/format
 * surfaces stop carrying their own private copies (digest-batch, digestEmail,
 * webPushPayload, home-page, onboarding each had one).
 *
 * Rule: для числа n выбирается одна из трёх форм — единственная (1 компания),
 * небольшая (2–4 компании), множественная (5 компаний, 11 компаний).
 * Особые случаи: 11–14 всегда множественная.
 */

type PluralForms = readonly [one: string, few: string, many: string]

/** Pick the correct Russian plural form for `count`. */
export function pluralForm(count: number, forms: PluralForms): string {
  const abs = Math.abs(count)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

/** "компания" / "компании" / "компаний". */
export function pluralCompanies(count: number): string {
  return pluralForm(count, ["компания", "компании", "компаний"])
}

/** "вакансия" / "вакансии" / "вакансий" — prefixed with the count. */
export function formatVacanciesCount(count: number): string {
  return `${count} ${pluralForm(count, ["вакансия", "вакансии", "вакансий"])}`
}

/** "сильный лид" / "сильных лида" / "сильных лидов". */
export function pluralizeLeads(count: number): string {
  return pluralForm(count, ["сильный лид", "сильных лида", "сильных лидов"])
}
