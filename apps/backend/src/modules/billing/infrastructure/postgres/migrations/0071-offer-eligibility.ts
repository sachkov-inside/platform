export const name = "0071_offer_eligibility";
export const statement = `
ALTER TABLE billing.offers ADD COLUMN eligibility text NOT NULL DEFAULT 'everyone'
  CHECK (eligibility IN ('everyone', 'former_tribute_subscribers'));
`;
