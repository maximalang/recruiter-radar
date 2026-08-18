# Production hardening state primitives

Added foundations for:

- RadarOperationalState: dashboard operational visibility contract.
- ProductErrorState: shared safe error presentation contract.

Next migration steps:

- replace page-local error rendering with the shared primitive;
- connect dashboard state data to runtime sources;
- add telemetry adapters without exposing private data;
- split static empty states from live status announcements.
