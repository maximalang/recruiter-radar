# Profile + Filters Redesign (Block 2)

Date: 2026-06-29

Make the client profile and its filters genuinely useful for Russian recruiting
agencies — sharper targeting, honest feedback before the first digest, and a
lead card a recruiter can act on in one glance. No new source layer.

## Audit (before)

`matchesClientProfile` (hard gate) used: industries (keyword), includeKeywords,
excludeKeywords, excludedIndustries, excludedLocations, contactPolicy.
`getClientScopeScore` (ranking boost) used: targetCity, specialization,
industries, roles. Findings:

- **`companySizes` was dead** — collected + stored, used by neither the gate nor
  the ranking, and no headcount data exists on orgs/candidates.
- **High-leverage signals were NOT filterable** despite the data being present on
  `digest_candidates`: intent strength (`total_score`), signal freshness
  (`latest_published_at`), open-role count (`vacancies_count`).
- **No completion / preview UX** — a user saved blind and waited a full digest
  cycle to learn if filters were too narrow.

## New filter model

Three data-backed hard thresholds added to `client_profiles`, each a pure read of
an existing `digest_candidates` column, all nullable / no-op when unset (no
leads=0 regression):

| Column | Meaning | Source column |
|---|---|---|
| `hiring_intent_min` (REAL, 0..4) | min FIUR total | `total_score` |
| `signal_freshness_days` (INT >0) | max signal age in days | `latest_published_at` |
| `min_open_roles` (INT ≥0) | min parsed vacancies | `vacancies_count` |

Migration `20260629130000_add_client_profile_targeting_thresholds` (+ down) with
range CHECK constraints. Validation in `clientProfiles.ts`
(`normalizeHiringIntentMin` clamps to [0,4]; 0 floors → null = "unset").

`matchesClientProfile` applies each only when set. The freshness gate KEEPS
candidates with no date (absence cannot prove staleness — protects
registry-sourced leads). `companySizes` stays collected (ranking-only) and is
documented inactive pending headcount enrichment.

Deferred (need data not yet on the candidate row): `exclude_companies` /
`include_companies` by INN/domain (orgs.inn/domain not in DigestItemInput).

## Profile completion UX

- `lib/profileCompletion.ts` — `computeProfileCompletion` (pure): 5 key groups
  (roles, industries, region, size, intent), filled/total + ratio.
- `app/settings/profile/profile-completion-panel.tsx` (+css) — progress bar +
  checklist + live "≈N компаний сейчас подходят" preview + empty-state nudge.
- `lib/digest.ts` `countMatchingCandidatesForProfile` — runs the SAME evidence
  query + gate + matchesClientProfile path as the real digest (capped scan), so
  the preview number reflects exactly what the filters do.
- Settings page renders the panel above the form; save-confirmation copy states
  filters apply to the next digest.

## Lead card quality (Telegram)

- FIUR score band in the header: 🔥 Горячий (≥3) / 🟠 Тёплый (≥2) / 🔵 Холодный.
- "Почему вам" — `lib/leads/why-match.ts` `buildWhyMatch` (pure): 2–3 concrete
  filter criteria the lead satisfies (role/industry/region/open-roles/intent),
  strongest-first, only true matches.
- "✨ AI-подсказка" — persisted enrichment summary, explicitly labelled, escaped,
  advisory only.
- All additive: every section omitted when its data is absent. The delivery query
  joins the profile filter columns + `ai_enrichment`.

## Tests

- `profile-filter.test.ts` — new gate coverage for hiringIntentMin /
  signalFreshnessDays / minOpenRoles (keep/drop/no-op/no-date).
- `profile-completion.test.ts` — completion breakdown.
- `why-match.test.ts` — match lines, limit, ordering.
- `telegram-lead-card.test.ts` — score band, why-match, AI hint, escaping.

Full suite green (1072 tests, 95 suites), tsc + web:build clean.

## Deferred

- Company-size filtering (needs headcount enrichment).
- include/exclude companies by INN/domain (needs orgs.inn/domain on the
  candidate row).
- Migrations `20260629120000` (ai_enrichment) and `20260629130000` (thresholds)
  not yet applied to the prod DB.
