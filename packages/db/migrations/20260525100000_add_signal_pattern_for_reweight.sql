BEGIN;

-- Добавляем колонку для хранения паттерна (industry/role/region),
-- чтобы отслеживать повторяющиеся badfit по паттерну для reweighting.
ALTER TABLE client_digest_org_state
  ADD COLUMN IF NOT EXISTS signal_pattern TEXT;

-- Индекс для быстрого поиска badfit по паттерну
CREATE INDEX IF NOT EXISTS client_digest_org_state_signal_pattern_idx
  ON client_digest_org_state (client_profile_id, signal_pattern, feedback_status)
  WHERE feedback_status = 'badfit';

COMMIT;