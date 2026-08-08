BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Restore the replay guard introduced by 20260807173000 when rolling this
-- migration back. This reproduces the exact pre-173500 behavior so the next
-- down migration can remove it cleanly.
CREATE OR REPLACE FUNCTION suppress_duplicate_company_event_signal_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.signal_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM company_event_publications existing
    WHERE existing.company_event_id = NEW.company_event_id
      AND existing.organization_id = NEW.organization_id
      AND existing.signal_id = NEW.signal_id
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_event_publications_signal_replay_guard
  ON company_event_publications;
CREATE TRIGGER company_event_publications_signal_replay_guard
BEFORE INSERT ON company_event_publications
FOR EACH ROW EXECUTE FUNCTION suppress_duplicate_company_event_signal_publication();

COMMIT;
