BEGIN;

ALTER TABLE opportunities
  ADD COLUMN public_reference UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX opportunities_public_reference_uidx
  ON opportunities (public_reference);

COMMIT;
