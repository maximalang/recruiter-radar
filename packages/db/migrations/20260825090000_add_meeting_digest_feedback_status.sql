BEGIN;

ALTER TYPE digest_feedback_status ADD VALUE IF NOT EXISTS 'meeting';

COMMIT;
