export const name = "0118_billing_automatic_cancel_refund";

// #1932: money that a late automatic Cancel of a retired attempt returned to the buyer is an
// ordinary refund row with its own basis. Inside records it without an owner command, so the basis
// is admitted only without an actor and only as an executed decision. Owner commands keep their
// bases. Every stored decision satisfies the new checks: the basis set only grows, and owner
// decisions never carried this basis.
export const statement = `
alter table billing.refund_decisions drop constraint billing_refund_decisions_basis_check;
alter table billing.refund_decisions add constraint billing_refund_decisions_basis_check
 check (basis in ('withdrawal','compensation','automatic_cancel') and access in ('keep','revoke'));

alter table billing.refund_decisions drop constraint billing_refund_origin_check;
alter table billing.refund_decisions add constraint billing_refund_origin_check check (
 (actor_id is not null and operation_id is not null and basis is distinct from 'automatic_cancel')
 or (actor_id is null and operation_id is null and state='executed'
  and basis in ('withdrawal','automatic_cancel') and access in ('keep','revoke'))
);
`;
