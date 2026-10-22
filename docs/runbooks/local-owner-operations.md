# Owner release operations

Owner-only commands that run against a migrated database.

## Owner Account release bootstrap

After migrations and before serving production traffic, confirm that the owner exists in Logto and
run the explicit idempotent release command with that exact identity:

```bash
OWNER_LOGTO_ISSUER=https://auth.example.com/oidc \
OWNER_LOGTO_SUBJECT=<opaque-logto-subject> \
pnpm --filter @inside/backend release:bootstrap-owner
```

The command ensures one Account and `materials:manage` by default. Explicitly set
`OWNER_PERMISSION=communications:manage` or `OWNER_PERMISSION=billing:manage` to grant only that
management surface instead. It writes
redacted Account audit events including the selected permission,
and prints a JSON summary. It does not run from an application startup hook or public route and does
not need the owner's email. Repeating it reports that no Account or permission was created.

## Manual Member Profile moderation

Use the owner-only release operation to disable or restore the exact Profile by opaque identity
without exposing a public admin route or participant reporting flow:

```bash
PROFILE_MODERATION_ACTION=disable \
PROFILE_PUBLIC_ID=<opaque-public-profile-id> \
pnpm --filter @inside/backend release:moderate-profiles
```

Use `PROFILE_MODERATION_ACTION=restore` with the same `PROFILE_PUBLIC_ID` to restore it. Disable
increments the Profile version and writes redacted audit metadata; the operation never prints
Profile fields, Account identity, Membership evidence or provider data.
