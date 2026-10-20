export const name = "0111_notifications_email_trace_context";
export const statement = `
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE notifications.notification_outbox ADD COLUMN traceparent varchar(55);
ALTER TABLE notifications.commands ADD COLUMN traceparent varchar(55);
ALTER TABLE notifications.email_inbox ADD COLUMN traceparent varchar(55);
ALTER TABLE notifications.email_attempts ADD COLUMN traceparent varchar(55);
`;
