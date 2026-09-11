export const name = "0058_offer_for_sale";
export const statement = `
ALTER TABLE billing.offers ADD COLUMN published boolean NOT NULL DEFAULT false;
`;
