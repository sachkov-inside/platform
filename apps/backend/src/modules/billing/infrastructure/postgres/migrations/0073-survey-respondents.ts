export const name = "0073_survey_respondents";
export const statement = `
CREATE TABLE billing.survey_respondents (
  username text PRIMARY KEY CHECK (username ~ '^[a-z][a-z0-9_]{3,31}$'),
  imported_at timestamptz NOT NULL,
  promotion_id uuid UNIQUE REFERENCES billing.promotions(id),
  issued_at timestamptz,
  CHECK ((promotion_id IS NULL) = (issued_at IS NULL))
);
`;
