/**
 * Next-delivery hint — renders "Когда придёт следующая подборка" in the UI.
 *
 * Honesty contract: the daily cron fires ONCE at 03:00 UTC for every profile.
 * Exact per-user HH:MM delivery is NOT honored yet (would require an hourly
 * cron + splitting the global ingest — out of scope for Block 3). So the hint
 * is orientation, not a hard schedule: it shows the next cron boundary
 * (03:00 UTC) expressed in the user's chosen timezone, with the user's
 * preferred local time shown alongside as the *target* we aim for.
 *
 * weekly frequency: the digest rides the daily cron but is skipped on
 * non-target days. Target day = Monday (start of the RU work week).
 */

import type { DeliveryFrequency, DeliveryPreferences } from "../deliveryPreferences";

/** Daily cron boundary, in UTC. */
const CRON_UTC_HOUR = 3;
const CRON_UTC_MINUTE = 0;
/** Weekly target day-of-week (1 = Monday, per Date#getDay where 0=Sunday). */
const WEEKLY_TARGET_DOW = 1;

export type NextDeliveryHint = {
  /** Russian label, e.g. "Сегодня ~06:00 (Москва)" or "Завтра ~06:00". */
  label: string;
  /** ISO of the next run instant, for callers that want a machine value. */
  nextRunIso: string;
  /** Whether the user has explicitly chosen a preferred local time. */
  hasPreferredTime: boolean;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function nextCronUtcInstant(from: Date): Date {
  const candidate = new Date(from.getTime());
  candidate.setUTCHours(CRON_UTC_HOUR, CRON_UTC_MINUTE, 0, 0);
  if (candidate.getTime() <= from.getTime()) {
    return addDays(candidate, 1);
  }
  return candidate;
}

function nextWeeklyCronUtcInstant(from: Date): Date {
  // Find the next cron boundary, then advance to the next Monday if needed.
  let run = nextCronUtcInstant(from);
  for (let i = 0; i < 8; i += 1) {
    if (run.getUTCDay() === WEEKLY_TARGET_DOW) return run;
    run = addDays(run, 1);
  }
  return run;
}

/**
 * Format a UTC instant in the target timezone using Intl. Falls back to UTC
 * when the tz is unrecognized, so a typo never crashes the UI.
 */
function formatInTz(instant: Date, timezone: string, now: Date): {
  time: string;
  weekday: "today" | "tomorrow" | "other";
  dateLabel: string;
} {
  // Resolve the effective tz once: invalid tz falls back to UTC so a typo
  // never crashes the UI.
  let resolvedTz: string;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: timezone });
    resolvedTz = timezone;
  } catch {
    resolvedTz = "UTC";
  }

  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: resolvedTz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);

  // Calendar-day keys in the target tz for the run instant, the reference
  // "now", and "now + 1 day". Comparing keys in the SAME tz (rather than UTC
  // or the system clock) is what makes today/tomorrow correct across DST
  // transitions and tz-boundary days where the local calendar day differs
  // from the UTC one. Using the injected `now` (not `new Date()`) is what
  // makes the hint deterministic in tests.
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolvedTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const runDayStr = dayFmt.format(instant);
  const nowStr = dayFmt.format(now);
  const tomorrowStr = dayFmt.format(addDays(now, 1));

  let weekday: "today" | "tomorrow" | "other";
  if (runDayStr === nowStr) weekday = "today";
  else if (runDayStr === tomorrowStr) weekday = "tomorrow";
  else weekday = "other";

  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: resolvedTz,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .formatToParts(instant)
    .filter((p) => p.type === "weekday" || p.type === "day" || p.type === "month")
    .map((p) => p.value)
    .join(" ");

  return { time, weekday, dateLabel };
}

/**
 * Compute the next-delivery hint for a profile's preferences.
 *
 * @param prefs delivery preferences (from getDeliveryPreferencesByOwnerId)
 * @param now   optional clock injection for tests
 */
export function computeNextDeliveryHint(
  prefs: Pick<
    DeliveryPreferences,
    "deliveryTimezone" | "deliveryFrequency" | "deliveryTimeLocal"
  >,
  now: Date = new Date(),
): NextDeliveryHint {
  const isWeekly = prefs.deliveryFrequency === "weekly";
  const runInstant = isWeekly ? nextWeeklyCronUtcInstant(now) : nextCronUtcInstant(now);
  const { time, weekday, dateLabel } = formatInTz(runInstant, prefs.deliveryTimezone, now);

  const tzShort = tzLabel(prefs.deliveryTimezone);
  let label: string;
  if (weekday === "today") {
    label = `Сегодня ~${time} ${tzShort}`.trim();
  } else if (weekday === "tomorrow") {
    label = `Завтра ~${time} ${tzShort}`.trim();
  } else {
    label = `${capFirst(dateLabel)} ~${time} ${tzShort}`.trim();
  }

  if (isWeekly) {
    label += " · раз в неделю";
  }

  return {
    label,
    nextRunIso: runInstant.toISOString(),
    hasPreferredTime: prefs.deliveryTimeLocal != null,
  };
}

function capFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Short human tz label for the hint, e.g. "Москва" for Europe/Moscow. */
function tzLabel(timezone: string): string {
  const known: Record<string, string> = {
    "Europe/Moscow": "Москва",
    "Europe/Kaliningrad": "Калининград",
    "Asia/Yekaterinburg": "Екатеринбург",
    "Asia/Novosibirsk": "Новосибирск",
    "Asia/Krasnoyarsk": "Красноярск",
    "Asia/Irkutsk": "Иркутск",
    "Asia/Yakutsk": "Якутск",
    "Asia/Vladivostok": "Владивосток",
    "Europe/Samara": "Самара",
  };
  return known[timezone] ?? timezone;
}

/**
 * Should this profile receive a digest on the run whose UTC instant is `runUtc`?
 *
 * weekly: only on Mondays (in UTC — the cron boundary). daily: always true.
 * Used by the delivery gate in the daily-radar route.
 */
export function shouldDeliverOnRun(
  frequency: DeliveryFrequency,
  runUtc: Date,
): boolean {
  if (frequency === "daily") return true;
  return runUtc.getUTCDay() === WEEKLY_TARGET_DOW;
}
