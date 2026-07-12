/**
 * Shared ICP option dictionaries (key → Russian label) for every client-profile
 * form: pilot onboarding and the /profile editor. Single source of the
 * human-facing labels so onboarding and settings never drift.
 *
 * This module is imported by CLIENT components, so it must stay free of any
 * server-only runtime dependency. It therefore uses `import type` only — the
 * canonical whitelists (VALID_INDUSTRIES etc.) live in clientProfiles.ts, which
 * transitively pulls in `pg` and must never reach the browser bundle. The
 * key⊆whitelist invariant is enforced by a server-side unit test
 * (client-profile-options.test.ts), not a build-time guard here.
 */

import type { ClientProfile } from "./clientProfiles";

export type ProfileOption = { key: string; label: string };

/** Industry options — keys must match VALID_INDUSTRIES. */
export const INDUSTRY_OPTIONS: readonly ProfileOption[] = [
  { key: "it", label: "IT / Digital" },
  { key: "finance", label: "Финансы / Банки" },
  { key: "manufacturing", label: "Производство" },
  { key: "retail", label: "Ритейл / Торговля" },
  { key: "healthcare", label: "Здравоохранение / Фарма" },
  { key: "construction", label: "Строительство" },
  { key: "logistics", label: "Логистика / Транспорт" },
  { key: "consulting", label: "Консалтинг" },
  { key: "education", label: "Образование" },
  { key: "media", label: "Медиа" },
  { key: "agro", label: "АПК / Сельское хозяйство" },
  { key: "hospitality", label: "HoReCa / Туризм" },
  { key: "energy", label: "Энергетика / Сырьё" },
  { key: "government", label: "Госсектор / НКО" },
  { key: "real-estate", label: "Недвижимость" },
  { key: "telecom", label: "Телеком / Связь" },
  { key: "auto", label: "Авто / Транспортные услуги" },
] as const;

/** Company size options — keys must match VALID_COMPANY_SIZES. */
export const COMPANY_SIZE_OPTIONS: readonly ProfileOption[] = [
  { key: "startup", label: "Стартап (1–10)" },
  { key: "small", label: "Малая (10–50)" },
  { key: "medium", label: "Средняя (50–250)" },
  { key: "large", label: "Крупная (250–1000)" },
  { key: "enterprise", label: "Корпорация (1000+)" },
] as const;

/** Role options — keys must match VALID_ROLES. */
export const ROLE_OPTIONS: readonly ProfileOption[] = [
  { key: "it-engineering", label: "IT-инженерия" },
  { key: "data", label: "Data / ML / AI" },
  { key: "product", label: "Product / Project" },
  { key: "sales", label: "Продажи" },
  { key: "marketing", label: "Маркетинг" },
  { key: "hr", label: "HR / Люди" },
  { key: "finance", label: "Финансы / Бухгалтерия" },
  { key: "operations", label: "Операции / Логистика" },
  { key: "legal", label: "Юриспруденция" },
  { key: "executive", label: "C-level / Руководство" },
  { key: "other", label: "Другое" },
] as const;

/** Contact-policy options — keys must match ClientProfile['contactPolicy']. */
export const CONTACT_POLICY_OPTIONS: ReadonlyArray<{
  key: ClientProfile["contactPolicy"];
  label: string;
}> = [
  { key: "corporate_only", label: "Только корпоративные каналы (безопасно)" },
  { key: "no_personal", label: "Без личных контактов сотрудников" },
  { key: "unrestricted", label: "Без ограничений" },
] as const;

/**
 * Hiring-mode options — keys must match ClientProfile['hiringMode'] /
 * VALID_HIRING_MODES. Labels are calm, premium, and describe the practice
 * type so an agency recognises itself rather than guessing what "executive"
 * means. `auto` is the recommended default for a new agency, but it resolves
 * to ONE concrete mode (see resolveHiringMode) — it does not blend practices.
 */
export const HIRING_MODE_OPTIONS: ReadonlyArray<{
  key: ClientProfile["hiringMode"];
  label: string;
  /** Short helper shown under the option — what the mode changes in the radar. */
  hint: string;
}> = [
  {
    key: "auto",
    label: "Авто (по ролям)",
    hint: "Режим определяется по выбранным ролям: executive-роль → executive, промышленность/логистика → volume, иначе specialist. Подходит, когда у вас одна основная практика.",
  },
  {
    key: "specialist",
    label: "Спец-практика (нишевый найм)",
    hint: "IT / digital / финансы. Мало ролей, важна релевантность и свежесть, объём не решает.",
  },
  {
    key: "executive",
    label: "Executive search (C-level)",
    hint: "Руководители и топ-менеджмент. Главный сигнал — seniority, объём вакансий — шум.",
  },
  {
    key: "volume",
    label: "Массовый найм",
    hint: "Промышленность, логистика, продажи, операционный линейный найм. Главный сигнал — объём и burst.",
  },
] as const;

/**
 * Short Russian label for a resolved (non-auto) hiring mode — used by the
 * profile "currently active mode" badge and any surface that needs to name the
 * effective mode without re-deriving it. Accepts only the three concrete modes;
 * `auto` is resolved upstream via resolveHiringMode before reaching here.
 */
export const RESOLVED_HIRING_MODE_LABEL: Readonly<Record<
  Exclude<ClientProfile["hiringMode"], "auto">,
  string
>> = {
  specialist: "Спец-практика",
  executive: "Executive search",
  volume: "Массовый найм",
};
