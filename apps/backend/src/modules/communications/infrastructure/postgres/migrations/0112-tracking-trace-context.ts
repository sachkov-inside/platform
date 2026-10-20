export const name = "0112_communications_tracking_trace_context";
export const statement = `
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE communications.tracking_hits ADD COLUMN traceparent varchar(55);
`;
