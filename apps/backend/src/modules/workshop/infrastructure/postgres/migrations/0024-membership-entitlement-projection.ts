export const name = "0024_workshop_membership_entitlement_projection";

export const statement = `
  create table workshop.membership_entitlement_projections (
    account_id uuid primary key,
    principal_ref varchar(256) not null,
    decision text not null,
    evidence_ref varchar(256) not null,
    evidence_version bigint not null,
    evidence_fingerprint char(64) not null,
    checked_at timestamptz not null,
    valid_until timestamptz not null,
    updated_at timestamptz not null,
    constraint workshop_membership_entitlement_principal_unique unique (principal_ref),
    constraint workshop_membership_entitlement_decision_check check (
      decision in ('member', 'not_member')
    ),
    constraint workshop_membership_entitlement_version_positive check (evidence_version > 0),
    constraint workshop_membership_entitlement_validity_check check (valid_until > checked_at)
  );

  insert into workshop.membership_entitlement_projections (
    account_id,
    principal_ref,
    decision,
    evidence_ref,
    evidence_version,
    evidence_fingerprint,
    checked_at,
    valid_until,
    updated_at
  )
  select
    account_id,
    principal_ref,
    decision,
    evidence_ref,
    evidence_version,
    evidence_fingerprint,
    checked_at,
    valid_until,
    updated_at
  from membership_entitlements.current_projections;
`;
