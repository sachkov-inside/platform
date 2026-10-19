export const name = "0110_notifications_notification_trace_context";
export const statement = `
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE notifications.inbox ADD COLUMN traceparent varchar(55);
`;
