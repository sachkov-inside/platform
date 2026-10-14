export const name = "0091_product_communities";
export const statement = `
CREATE TABLE telegram_membership.product_communities (
  product_id uuid PRIMARY KEY,
  group_ref varchar(100) CHECK (group_ref IS NULL OR group_ref = 'primary'),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL
);
-- The existing group remains the initial Product group. Association grants no rights.
INSERT INTO telegram_membership.product_communities (product_id, group_ref, updated_by, updated_at)
SELECT id, 'primary', '00000000-0000-0000-0000-000000000000'::uuid, now() FROM materials.series;
`;
