export const name = "0100_product_waitlists";

// Intake identity is explicit and immutable. Cohort edits and dates never allocate another intake.
export const statement = `
CREATE TABLE sales_funnel.product_waitlist_intakes (
 id uuid PRIMARY KEY,
 product_id uuid NOT NULL,
 name text NOT NULL,
 accepting boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_waitlist_intakes_current ON sales_funnel.product_waitlist_intakes(product_id) WHERE accepting;
CREATE TABLE sales_funnel.product_waitlist_memberships (
 intake_id uuid NOT NULL REFERENCES sales_funnel.product_waitlist_intakes(id),
 account_id uuid NOT NULL,
 active boolean NOT NULL,
 source text,
 joined_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(intake_id, account_id),
 CHECK (source IS NULL OR char_length(source) BETWEEN 1 AND 64)
);
CREATE TABLE sales_funnel.product_waitlist_events (
 id uuid PRIMARY KEY,
 intake_id uuid NOT NULL REFERENCES sales_funnel.product_waitlist_intakes(id),
 account_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('joined', 'withdrawn')),
 source text,
 occurred_at timestamptz NOT NULL
);
CREATE TABLE sales_funnel.product_waitlist_operations (
 id uuid PRIMARY KEY,
 intake_id uuid NOT NULL REFERENCES sales_funnel.product_waitlist_intakes(id),
 account_id uuid NOT NULL,
 source text,
 created_at timestamptz NOT NULL
);
CREATE INDEX product_waitlist_events_period ON sales_funnel.product_waitlist_events(intake_id, occurred_at);
INSERT INTO sales_funnel.product_waitlist_intakes(id,product_id,name,accepting)
 SELECT 'd4f674dc-a1a9-4f86-8855-e4d904d2845f',id,'Следующий набор',true
 FROM materials.series WHERE slug='ai-engineering' AND archived_at IS NULL;
`;
