/**
 * One append-only journal of accepted legal documents (Platform #658). Payment consent evidence
 * already had the right shape and immutability, so it becomes the journal: first sign-in writes
 * the terms of use here too, without a verified receipt contact. Every new row names the screen
 * and the button label the person pressed; subscription rows also keep the renewal terms shown next
 * to that button. Rows written before this migration keep their original columns: the trigger
 * forbids rewriting them, so the new presentation constraint is declared `not valid`.
 */
export const name = "0067_legal_acceptances";
export const statement = `
alter table accounts.billing_consent_evidence rename to legal_acceptances;
alter table accounts.legal_acceptances rename constraint billing_consent_evidence_pkey to legal_acceptances_pkey;
alter table accounts.legal_acceptances rename constraint billing_consent_evidence_account_id_operation_id_kind_key to legal_acceptances_account_operation_kind_key;
alter table accounts.legal_acceptances rename constraint billing_consent_evidence_kind_check to legal_acceptances_kind_check;
alter table accounts.legal_acceptances rename constraint billing_consent_evidence_account_id_fkey to legal_acceptances_account_id_fkey;
alter trigger billing_consent_evidence_immutable on accounts.legal_acceptances rename to legal_acceptances_immutable;
alter table accounts.legal_acceptances alter column context_ref drop not null;
alter table accounts.legal_acceptances
 add column screen text,
 add column button_label text,
 add column shown_terms jsonb;
alter table accounts.legal_acceptances
 add constraint legal_acceptances_screen_check
  check (screen in ('first-sign-in', 'checkout', 'subscription-resume')),
 add constraint legal_acceptances_context_check
  check (context_ref is not null or screen = 'first-sign-in'),
 add constraint legal_acceptances_shown_terms_check
  check (shown_terms is null or (screen <> 'first-sign-in' and jsonb_typeof(shown_terms) = 'object'));
alter table accounts.legal_acceptances
 add constraint legal_acceptances_presented_check
  check (screen is not null and button_label is not null and char_length(button_label) between 1 and 200)
  not valid;
create index legal_acceptances_account_time on accounts.legal_acceptances(account_id, accepted_at);
`;
