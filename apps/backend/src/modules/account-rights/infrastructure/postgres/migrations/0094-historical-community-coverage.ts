export const name = "0094_historical_community_coverage";

/** Complete 0090 for journaled historical empty scopes without reinterpreting newer decisions. */
export const statement = `
WITH historical AS (
  SELECT grant_row.id
  FROM account_rights.access_grants AS grant_row
  JOIN public.platform_migrations AS baseline ON baseline.name = '0090_explicit_community_rights'
  WHERE grant_row.coverage = '{"productIds":[],"materialIds":[]}'::jsonb
    AND 'community' = ANY(grant_row.capabilities)
    AND EXISTS (
      SELECT 1 FROM account_rights.access_changes AS change
      WHERE change.grant_id = grant_row.id AND change.recorded_at <= baseline.applied_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM account_rights.access_changes AS change
      WHERE change.grant_id = grant_row.id AND change.recorded_at > baseline.applied_at
    )
)
UPDATE account_rights.access_grants AS grant_row
SET coverage = CASE
  WHEN EXISTS (SELECT 1 FROM unnest(grant_row.capabilities) AS capability WHERE capability LIKE 'product:%')
  THEN jsonb_build_object('productIds', (
    SELECT jsonb_agg(substring(capability from 9)) FROM unnest(grant_row.capabilities) AS capability WHERE capability LIKE 'product:%'
  ), 'materialIds', '[]'::jsonb)
  WHEN grant_row.source = 'paid'
  THEN (
    SELECT jsonb_build_object('productIds', (
      SELECT jsonb_agg(substring(capability from 9)) FROM jsonb_array_elements_text(purchase.snapshot->'offer'->'benefits') AS capability WHERE capability LIKE 'product:%'
    ), 'materialIds', '[]'::jsonb)
    FROM billing.purchases AS purchase
    WHERE split_part(grant_row.source_ref, ':', 1) = purchase.id::text AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(purchase.snapshot->'offer'->'benefits') AS capability WHERE capability LIKE 'product:%'
    )
  )
  ELSE NULL
END
FROM historical
WHERE grant_row.id = historical.id;
`;
