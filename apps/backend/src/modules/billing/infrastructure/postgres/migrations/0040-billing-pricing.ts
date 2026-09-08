export const name = "0040_billing_pricing";
export const statement = `
CREATE SCHEMA billing;
CREATE TABLE billing.offers (
  id uuid PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  benefits text[] NOT NULL CHECK (cardinality(benefits) BETWEEN 1 AND 2 AND benefits <@ ARRAY['materials','community']::text[]),
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE billing.payment_options (
  id uuid PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0),
  offer_id uuid NOT NULL REFERENCES billing.offers(id),
  months integer NOT NULL CHECK (months > 0),
  price_kopecks bigint NOT NULL CHECK (price_kopecks BETWEEN 1 AND 9007199254740991),
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE billing.promotions (
  id uuid PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0),
  name text NOT NULL, percent integer NOT NULL CHECK (percent BETWEEN 1 AND 100),
  code text UNIQUE, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  offer_ids uuid[] NOT NULL, payment_option_ids uuid[] NOT NULL,
  usage_limit integer CHECK (usage_limit > 0), archived boolean NOT NULL DEFAULT false,
  CHECK (starts_at < ends_at)
);
CREATE TABLE billing.pricing_commands (
  actor uuid NOT NULL, operation_id uuid NOT NULL, fingerprint text NOT NULL,
  outcome jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, operation_id)
);
CREATE TABLE billing.price_quotes (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, operation_id uuid NOT NULL,
  fingerprint text NOT NULL, snapshot jsonb NOT NULL, promo_code text,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  UNIQUE (account_id, operation_id), CHECK (created_at < expires_at)
);
CREATE TABLE billing.promo_reservations (
  purchase_ref uuid PRIMARY KEY, account_id uuid NOT NULL,
  quote_ref uuid NOT NULL UNIQUE REFERENCES billing.price_quotes(id),
  promotion_id uuid REFERENCES billing.promotions(id),
  state text NOT NULL CHECK (state IN ('reserved','sent','unknown','confirmed','failed')),
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_one_open_pricing_reservation ON billing.promo_reservations(account_id)
  WHERE state IN ('reserved','sent','unknown');
CREATE INDEX billing_promotion_usage ON billing.promo_reservations(promotion_id, state);
`;
