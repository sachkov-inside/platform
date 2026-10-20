export const name = "0113_waitlist_trace_context";
export const statement = `
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE sales_funnel.product_waitlist_confirmations ADD COLUMN traceparent varchar(55);
`;
