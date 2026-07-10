/**
 * Contact-surface display helpers — turn the auto-discovered contact_paths
 * (career-page HTML extraction) into agency-facing Russian copy + structured
 * rows for the lead card / lead detail / digest.
 *
 * The contact_paths taxonomy mirrors lib/scoring/contact-paths.ts:
 *   hr-email, careers-email, generic-email, personal-email,
 *   phone, contact-form, telegram, whatsapp
 *
 * Filtering by the client's contact policy happens in the scoring/delivery
 * layer (lib/contact-policy-filter.ts); these helpers are display-only and
 * receive already-policy-filtered paths, so a corporate_only agency never sees
 * a personal-email rendered as a "safe path".
 */

export interface ContactPathView {
  category: string;
  value: string;
  /** True for HR/careers mailboxes — the surfaces the agency most wants. */
  isHiringSurface: boolean;
  /** Short Russian label for the channel ("HR-почта", "Телефон", …). */
  label: string;
  /** Copy-ready string: label + value, e.g. "HR-почта: hr@company.ru". */
  display: string;
  /** href for clickable channels (mailto:/tel:/https:); null for non-link. */
  href: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  'hr-email': 'HR-почта',
  'careers-email': 'Почта для вакансий',
  'generic-email': 'Общая почта',
  'personal-email': 'Личная почта',
  'phone': 'Телефон',
  'contact-form': 'Форма обратной связи',
  'telegram': 'Telegram',
  'whatsapp': 'WhatsApp',
};

const HR_CATEGORIES = new Set(['hr-email', 'careers-email']);

function hrefFor(category: string, value: string): string | null {
  switch (category) {
    case 'hr-email':
    case 'careers-email':
    case 'generic-email':
    case 'personal-email':
      return `mailto:${value}`;
    case 'phone':
      return `tel:${value.replace(/[^\d+]/g, '')}`;
    case 'contact-form':
    case 'telegram':
    case 'whatsapp':
      return value;
    default:
      return null;
  }
}

/**
 * Build display rows for a list of contact paths. Paths are expected to already
 * be policy-filtered by the caller. Unknown categories fall through with a
 * generic label so a new category never breaks the UI.
 */
export function toContactPathViews(
  paths: ReadonlyArray<{ category: string; value: string }>,
): ContactPathView[] {
  if (!Array.isArray(paths)) return [];
  return paths.map((p) => {
    const label = CATEGORY_LABELS[p.category] ?? 'Контакт';
    return {
      category: p.category,
      value: p.value,
      isHiringSurface: HR_CATEGORIES.has(p.category),
      label,
      display: `${label}: ${p.value}`,
      href: hrefFor(p.category, p.value),
    };
  });
}

/**
 * True when the contact surface includes at least one corporate, non-personal
 * channel — i.e. the lead is reachable via a safe path the agency can use
 * without contacting a private individual. Mirrors hasCorporateSurface in
 * lib/contact-policy-filter.ts but is display-side (no policy dependency).
 */
export function hasCorporateContact(
  paths: ReadonlyArray<{ category: string; value: string }>,
): boolean {
  if (!Array.isArray(paths)) return false;
  return paths.some((p) =>
    p.category === 'hr-email' ||
    p.category === 'careers-email' ||
    p.category === 'generic-email' ||
    p.category === 'contact-form',
  );
}
