export const name = "0108_materials_notification_trace_context";
export const statement = `
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE materials.notification_outbox ADD COLUMN traceparent varchar(55);
`;
