export const name = "0101_billing_funnel_diagnostic_sources";

export const statement = `
create index price_quotes_product_coverage on billing.price_quotes using gin ((snapshot -> 'offer' -> 'coverage' -> 'productIds'));
create index purchases_product_coverage_confirmed on billing.purchases using gin ((snapshot -> 'offer' -> 'coverage' -> 'productIds')) where state = 'confirmed' and kind in ('initial', 'one_time');
create index survey_respondents_issued on billing.survey_respondents(issued_at) where issued_at is not null;
`;
