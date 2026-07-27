BEGIN;

-- This migration only repairs customer state from the append-only action log.
-- Reversing that repair would knowingly restore an incorrect lifecycle state.

COMMIT;
