export const name = "0092_product_access_exclusions";
export const statement = `
CREATE TABLE account_rights.product_access_exclusions (
  account_id uuid NOT NULL,
  product_id uuid NOT NULL,
  grant_ids uuid[] NOT NULL,
  bridge boolean NOT NULL DEFAULT false,
  actor_id uuid NOT NULL,
  reason varchar(1000) NOT NULL,
  revoked_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, product_id)
);
`;
