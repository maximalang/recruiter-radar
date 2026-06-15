BEGIN;

-- Reverse the deprecation markers (restore NULL table comments).

COMMENT ON TABLE leads IS NULL;
COMMENT ON TABLE lead_status IS NULL;
COMMENT ON TABLE deliveries IS NULL;

COMMIT;
