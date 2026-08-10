// The isolated Quality v2 verifier asserts descendant-first rollback and that
// Opportunity v3 ancestors remain intact. Keep this named entrypoint so CI and
// operators can run the rollback contract independently from other DB gates.
await import('./run-commercial-signal-quality-v2-db-tests.mjs')
