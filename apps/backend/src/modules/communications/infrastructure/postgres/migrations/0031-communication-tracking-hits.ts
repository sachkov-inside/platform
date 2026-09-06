export const name = "0031_communication_tracking_hits";
export const statement = `
  create schema communications;
  create table communications.tracking_hits (
    event_id uuid primary key,
    token varchar(128) not null check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
    occurred_at timestamptz not null,
    traffic varchar(32) not null check (traffic in ('unknown', 'known_automation')),
    available_at timestamptz not null,
    claim_id uuid,
    delivered_at timestamptz
  );
  create index tracking_hit_pending_idx on communications.tracking_hits (delivered_at, available_at);
`;
