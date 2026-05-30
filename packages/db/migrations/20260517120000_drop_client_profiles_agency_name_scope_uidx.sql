BEGIN;

-- Remove global unique index on (agency_name, target_city, specialization).
-- Two different customers with the same agency name and scope must not block
-- each other's onboarding. Tenant isolation is enforced in application code
-- via the checkout_orders ownership boundary, not at the DB index level.
DROP INDEX IF EXISTS client_profiles_agency_name_scope_uidx;

COMMIT;
