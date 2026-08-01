BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

CREATE FUNCTION validate_opportunity_outcome_assignee_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM opportunities opportunity
  JOIN workspace_members member
    ON member.workspace_id = opportunity.workspace_id
   AND member.user_id = NEW.assigned_user_id
  WHERE opportunity.id = NEW.opportunity_id
    AND opportunity.owner_id = NEW.owner_id
  FOR KEY SHARE OF member;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'outcome event assignee must belong to the opportunity workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_outcome_events_assignee_scope
BEFORE INSERT ON opportunity_outcome_events
FOR EACH ROW
EXECUTE FUNCTION validate_opportunity_outcome_assignee_scope();

COMMIT;
