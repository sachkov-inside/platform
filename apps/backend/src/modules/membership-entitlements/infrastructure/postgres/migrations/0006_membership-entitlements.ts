export const name = "0006_membership_entitlements";

export const statement = `
  create schema membership_entitlements;

  create table membership_entitlements.account_bindings (
    account_id uuid primary key,
    principal_ref varchar(256) not null,
    linked_at timestamptz not null,
    constraint membership_account_bindings_principal_unique unique (principal_ref),
    constraint membership_account_bindings_pair_unique unique (account_id, principal_ref),
    constraint membership_account_bindings_principal_nonempty check (length(principal_ref) > 0)
  );

  create table membership_entitlements.evidence_receipts (
    delivery_id varchar(256) primary key,
    account_id uuid not null,
    source text not null,
    request_fingerprint char(64) not null,
    principal_ref varchar(256),
    evidence_ref varchar(256),
    evidence_version bigint,
    decision text,
    outcome text not null,
    checked_at timestamptz,
    valid_until timestamptz,
    received_at timestamptz not null,
    retain_until timestamptz not null,
    constraint membership_evidence_receipts_delivery_nonempty check (length(delivery_id) > 0),
    constraint membership_evidence_receipts_source_check check (
      source in ('link_time', 'member_status_event', 'reconciliation')
    ),
    constraint membership_evidence_receipts_version_positive check (
      evidence_version is null or evidence_version > 0
    ),
    constraint membership_evidence_receipts_decision_check check (
      decision is null or decision in (
        'member',
        'not_member',
        'identity_not_linked',
        'identity_conflict',
        'unavailable'
      )
    ),
    constraint membership_evidence_receipts_outcome_check check (
      outcome in (
        'processing',
        'awaiting_binding',
        'applied',
        'accepted_without_entitlement',
        'duplicate',
        'unsupported_contract',
        'invalid_evidence',
        'principal_mismatch',
        'expired_evidence',
        'replayed_evidence'
      )
    ),
    constraint membership_evidence_receipts_retention_check check (retain_until > received_at)
  );

  create index membership_evidence_receipts_account_received_idx
    on membership_entitlements.evidence_receipts (account_id, received_at desc, delivery_id desc);
  create index membership_evidence_receipts_retention_idx
    on membership_entitlements.evidence_receipts (retain_until);

  create table membership_entitlements.current_projections (
    account_id uuid primary key,
    principal_ref varchar(256) not null,
    decision text not null,
    evidence_ref varchar(256) not null,
    evidence_version bigint not null,
    evidence_fingerprint char(64) not null,
    checked_at timestamptz not null,
    valid_until timestamptz not null,
    updated_at timestamptz not null,
    constraint membership_current_projections_binding_fk foreign key (account_id, principal_ref)
      references membership_entitlements.account_bindings (account_id, principal_ref),
    constraint membership_current_projections_principal_unique unique (principal_ref),
    constraint membership_current_projections_decision_check check (
      decision in ('member', 'not_member')
    ),
    constraint membership_current_projections_version_positive check (evidence_version > 0),
    constraint membership_current_projections_validity_check check (valid_until > checked_at)
  );
`;
