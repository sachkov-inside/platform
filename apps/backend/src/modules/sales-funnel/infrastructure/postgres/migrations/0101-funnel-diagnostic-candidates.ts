export const name = "0101_funnel_diagnostic_candidates";

export const statement = `
create index bot_events_link_account on sales_funnel.bot_events(account_id, contact_ref) where kind = 'account_linked';
create index bot_events_link_identity on sales_funnel.bot_events(telegram_identity_ref, contact_ref) where kind = 'account_linked';
create index bot_events_last_received on sales_funnel.bot_events(received_at desc);
`;
