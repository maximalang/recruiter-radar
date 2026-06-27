/**
 * Shared ICP option dictionaries (key → Russian label) for every client-profile
 * form: pilot onboarding and the /settings/profile editor. Single source of the
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
  { key: "it", label: "IT" },
  { key: "finance", label: "Финансы" },
  { key: "manufacturing", label: "Производство" },
  { key: "retail", label: "Ритейл" },
  { key: "healthcare", label: "Здравоохранение" },
  { key: "construction", label: "Строительство" },
  { key: "logistics", label: "Логистика" },
  { key: "consulting", label: "Консалтинг" },
  { key: "education", label: "Образование" },
  { key: "media", label: "Медиа" },
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
