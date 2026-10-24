export const name = "0110_product_sales_state";

/** Rename the one mutable presentation fact. Dates never publish a price or create an Intake. */
export const statement = `
ALTER TABLE billing.product_cohorts RENAME TO product_sales_states;
`;
