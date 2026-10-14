export const name = "0090_explicit_community_rights";

/** Preserve previously implicit community rights without changing financial snapshots. */
export const statement = `
UPDATE account_rights.access_grants
SET capabilities = array_append(capabilities, 'community')
WHERE NOT ('community' = ANY(capabilities))
  AND ('support' = ANY(capabilities) OR EXISTS (
    SELECT 1 FROM unnest(capabilities) AS capability WHERE capability LIKE 'product:%'
  ));
UPDATE account_rights.access_grants AS grant_row
SET coverage = jsonb_build_object('productIds', (
  SELECT jsonb_agg(substring(capability from 9)) FROM unnest(grant_row.capabilities) AS capability WHERE capability LIKE 'product:%'
), 'materialIds', '[]'::jsonb)
WHERE coverage IS NULL AND EXISTS (SELECT 1 FROM unnest(grant_row.capabilities) AS capability WHERE capability LIKE 'product:%');
UPDATE account_rights.access_grants AS grant_row
SET coverage = jsonb_build_object('productIds', (
  SELECT jsonb_agg(substring(capability from 9)) FROM jsonb_array_elements_text(purchase.snapshot->'offer'->'benefits') AS capability WHERE capability LIKE 'product:%'
), 'materialIds', '[]'::jsonb)
FROM billing.purchases AS purchase
WHERE grant_row.source = 'paid' AND split_part(grant_row.source_ref, ':', 1) = purchase.id::text
  AND grant_row.coverage IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(purchase.snapshot->'offer'->'benefits') AS capability WHERE capability LIKE 'product:%'
  );
UPDATE account_rights.legacy_classifications
SET bridge_benefits = array_append(bridge_benefits, 'community')
WHERE NOT ('community' = ANY(bridge_benefits)) AND 'support' = ANY(bridge_benefits);
`;
