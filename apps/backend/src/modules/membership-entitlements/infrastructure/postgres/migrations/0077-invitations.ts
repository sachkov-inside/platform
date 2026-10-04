export const name = "0077_invitations";
export const statement = `
ALTER TABLE billing.offers DROP CONSTRAINT offers_eligibility_check;
ALTER TABLE billing.offers ADD CONSTRAINT offers_eligibility_check
  CHECK (eligibility IN ('everyone', 'former_tribute_subscribers', 'invitation_only'));
ALTER TABLE membership_entitlements.subscription_enrollments DROP CONSTRAINT subscription_enrollments_origin_check;
ALTER TABLE membership_entitlements.subscription_enrollments ADD CONSTRAINT subscription_enrollments_origin_check
  CHECK (origin IN ('course', 'tribute', 'manual', 'platform_payment', 'invitation'));
CREATE TABLE membership_entitlements.invitations (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]+$'),
  offer_id uuid NOT NULL,
  offer_revision integer NOT NULL CHECK (offer_revision > 0),
  mode text NOT NULL CHECK (mode IN ('purchase', 'gift')),
  gift_months integer CHECK (gift_months BETWEEN 1 AND 1200),
  note varchar(200),
  issued_by uuid NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_identity_ref varchar(256),
  claimed_account_id uuid,
  redeemed_at timestamptz,
  enrollment_id uuid REFERENCES membership_entitlements.subscription_enrollments(id),
  revoked_at timestamptz,
  revision integer NOT NULL CHECK (revision > 0),
  CHECK (expires_at > issued_at),
  CHECK (mode = 'gift' OR gift_months IS NULL),
  CHECK ((claimed_at IS NULL) = (claimed_identity_ref IS NULL)),
  CHECK (redeemed_at IS NULL OR (claimed_at IS NOT NULL AND claimed_account_id IS NOT NULL)),
  CHECK ((mode = 'gift' AND redeemed_at IS NOT NULL) = (enrollment_id IS NOT NULL)),
  CHECK (revoked_at IS NULL OR redeemed_at IS NULL)
);
CREATE INDEX invitations_redeemed_account_idx ON membership_entitlements.invitations(claimed_account_id)
  WHERE redeemed_at IS NOT NULL;
CREATE INDEX invitations_issued_idx ON membership_entitlements.invitations(issued_at DESC, id);
`;
