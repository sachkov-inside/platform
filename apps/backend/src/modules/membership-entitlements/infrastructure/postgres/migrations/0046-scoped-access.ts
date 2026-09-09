export const name = "0046_scoped_access";
export const statement = `
ALTER TABLE membership_entitlements.access_grants DROP CONSTRAINT access_grants_capabilities_check;
ALTER TABLE membership_entitlements.access_grants ADD CONSTRAINT access_grants_capabilities_check CHECK (
 cardinality(capabilities) BETWEEN 1 AND 100 AND
 array_to_string(capabilities, ',') ~ '^(materials|community|reviews|support|guide:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(,(materials|community|reviews|support|guide:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))*$'
);
ALTER TABLE membership_entitlements.access_grants DROP CONSTRAINT access_grants_check1;
`;
