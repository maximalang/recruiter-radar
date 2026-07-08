BEGIN;

-- Universal agency model (2026-07-06): a hiring-mode dimension on
-- client_profiles so the product can behave differently for executive search,
-- mass/volume hiring, and specialist/niche agencies — instead of applying
-- identical matching/ranking/urgency/explanation weights to every agency.
--
--   'auto'       — infer the mode from the agency's declared roles (default).
--                  resolveHiringMode() in clientProfiles.ts performs the
--                  inference: an executive role present → 'executive';
--                  industrial/logistics + volume-shaped roles → 'volume';
--                  otherwise 'specialist'.
--   'specialist' — niche IT / digital / finance practice; few roles, high
--                  seniority, hard-to-fill matters. Current default behavior.
--   'executive'  — C-level / director search; seniority is the dominant fit
--                  signal, raw open-role volume is noise.
--   'volume'     — mass / industrial / logistics / sales-floor hiring;
--                  open-role volume and burst are the dominant signals.
--
-- The mode only REWEIGHTS within the existing gate pipeline (getClientScopeScore
-- ranking, deriveUrgencyCue, FIUR intent/urgency, fit-explanation). It NEVER
-- bypasses a confidence gate, never weakens evidence-first bars, and never
-- inflates lead counts. An unset / 'auto' profile keeps the pre-existing
-- specialist behavior — no leads=0 regression, no silent re-ranking of
-- existing profiles.
--
-- Additive: single nullable TEXT column with a CHECK constraint on the four
-- allowed values. Default 'auto' so every existing row picks up the
-- infer-and-fall-back path without a backfill.

ALTER TABLE client_profiles
  ADD COLUMN IF NOT EXISTS hiring_mode TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE client_profiles
  DROP CONSTRAINT IF EXISTS client_profiles_hiring_mode_values;
ALTER TABLE client_profiles
  ADD  CONSTRAINT client_profiles_hiring_mode_values
    CHECK (hiring_mode IN ('auto', 'specialist', 'executive', 'volume'));

COMMENT ON COLUMN client_profiles.hiring_mode IS 'Agency hiring practice mode: auto (infer from roles), specialist (niche), executive (C-level search), volume (mass hiring). Only reweights within the gate pipeline — never bypasses a confidence gate.';

COMMIT;
