export const name = "0029_communications_permission";

export const statement = `
  alter table accounts.account_permissions
    drop constraint account_permissions_value_check,
    add constraint account_permissions_value_check
      check (permission in ('materials:manage', 'communications:manage'));
  alter table accounts.account_audit_events add column permission text,
    add constraint account_audit_permission_check
      check (permission is null or permission in ('materials:manage', 'communications:manage'));
`;
