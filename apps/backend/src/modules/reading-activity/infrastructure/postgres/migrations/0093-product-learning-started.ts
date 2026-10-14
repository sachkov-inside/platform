export const name = "0093_product_learning_started";
export const statement = `
CREATE TABLE reading_activity.product_learning_started (
  account_id uuid NOT NULL,
  product_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, product_id)
);
INSERT INTO reading_activity.product_learning_started (account_id, product_id, started_at)
SELECT visit.account_id, membership.series_id, min(visit.first_opened_at)
FROM reading_activity.material_visits visit
JOIN materials.published_material_series_memberships membership ON membership.material_id = visit.material_id
GROUP BY visit.account_id, membership.series_id;
`;
