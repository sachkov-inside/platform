export const name = "0076_guide_cohorts";
export const statement = `
CREATE TABLE billing.guide_cohorts (
  guide_id uuid PRIMARY KEY,
  revision integer NOT NULL CHECK (revision > 0),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  stage text NOT NULL CHECK (stage IN ('announcement', 'preorder', 'running', 'between')),
  starts_on date,
  next_event text NOT NULL DEFAULT '' CHECK (char_length(next_event) <= 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage = 'between' OR starts_on IS NOT NULL),
  CHECK (stage <> 'between' OR next_event <> '')
);
`;
