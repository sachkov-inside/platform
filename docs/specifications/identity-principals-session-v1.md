# Account identity foundation v1

Статус: canonical application contract. Документ заменяет прежнюю модель
`IdentityPrincipals + Platform Session` по owner decision из
[Platform #124](https://github.com/sachkov-inside/platform/issues/124), 2026-08-26. Имя файла
сохранено как совместимый documentation path; канонические термины теперь находятся в
[`CONTEXT.md`](../../CONTEXT.md).

## Решение

Logto владеет аутентификацией по email-коду и подтверждению Telegram, OAuth/OIDC protocol, provider session,
refresh и logout. Platform владеет одним локальным `Account`, business permissions и будущим
`MembershipEntitlement`. Browser JavaScript не получает provider access/refresh tokens.

Platform не создаёт второй session layer. Official `@logto/next` encrypted `HttpOnly` cookie —
единственный BFF authentication context. Каждый protected backend request получает short-lived
Logto access JWT для exact Platform audience, проверяет его и разрешает существующий Account по
`(issuer, subject)`.

```text
email code / Telegram proof -> Logto -> official Next BFF cookie
                         |
                         | short-lived audience-bound access JWT
                         v
                  Nest JWT verifier
                         |
                         | verified issuer + subject
                         v
                       Account ---- exact DB check ----> materials:manage
                         |
                         +---- future MembershipEntitlement ----> ContentAccess
```

## Public interface

Application module `Accounts` предоставляет операции установления и разрешения Account, проверки
прав и серверного разрешения identity для подтверждённой Telegram-связи:

```ts
type PlatformPermission = "materials:manage" | "communications:manage" | "platform:admin";

interface AuthenticatedAccount {
  readonly accountId: string;
}

interface Accounts {
  establishAccount(command: {
    readonly identity: VerifiedAccountSignIn;
  }): Promise<EstablishAccountResult>;

  resolveAccount(query: {
    readonly identity: VerifiedAccountIdentity;
  }): Promise<ResolveAccountResult>;

  readIdentityForLink(accountId: string): Promise<{
    issuer: string; subject: string; telegramSubjectRef: string | null;
  } | undefined>;

  checkPermission(query: {
    readonly accountId: string;
    readonly permission: PlatformPermission;
  }): Promise<PermissionDecision>;
}
```

Only the Logto proof adapter constructs verified identity values. Provider token, claims, roles,
scopes, email and Next/Nest types do not enter this interface. `AuthenticatedAccount` deliberately
contains only `accountId`; permissions and Membership are not token/session snapshots.

## Account invariants

1. Account is a human Platform actor with stable UUID.
2. Exact `(logto_issuer, logto_subject)` is unique and authoritative. Subject is opaque and
   case-sensitive; issuer is an exact allowlisted HTTPS identifier.
3. First interactive callback may create Account only when the same validated access JWT contains
   Logto-signed `inside_verified_email` либо `inside_telegram_sign_in` из проверенного social
   connector. Telegram-proof принимается только при включённом серверном флаге.
4. Ordinary protected requests only resolve an existing Account and never provision one.
5. Verified email is normalized, stored only as versioned keyed HMAC fingerprint and never becomes
   the identity key.
6. A new subject with an already owned email fingerprint returns `identity_conflict`; no second
   Account, merge or transfer occurs.
7. A returning subject keeps the same Account. A changed verified email updates only the
   fingerprint when it is unowned; a conflict fails closed without transferring state.
8. Provider roles/scopes/claims never grant Platform permission, Membership or content access.
9. Account has no speculative `active/disabled` state. Logto suspension/revocation plus the
   maximum five-minute JWT lifetime is the current security boundary. Account administration is a
   separate future capability with its own consumer and revocation contract.

PostgreSQL uniqueness and transaction-scoped advisory locks arbitrate concurrent first sign-in.
There is no custom callback idempotency table: retrying a callback or losing a response converges
on the same unique Account.

## Authorization boundary

`materials:manage` covers create, full-state Save, validate,
preview, publish, unpublish, access change and never-published draft deletion. Materials still owns
validation, publication-state and stale-content-version rules; no separate owner GO exists inside
the product workflow.
`communications:manage` independently permits Telegram communications management. It never follows
from `materials:manage`; a confirmed author link is also required. The server-side actor mapping,
author callback and HTTP/MCP parity are defined in the
[communications integration contract](../integrations/communications-v1.md).
`platform:admin` is an explicit current Account grant covering every known Platform permission.
Only the trusted owner bootstrap can grant it (`OWNER_PERMISSION=platform:admin`); migration 0037
changes the constraint without promoting existing authors. The existing bootstrap default remains
`materials:manage`. Administrator status never comes from browser input or provider claims.
Revocation takes effect on the next operation. Membership and a confirmed Telegram identity link
remain independent business facts. This owner decision is recorded in #396.

The protected Materials operation calls `Accounts.checkPermission(accountId,
"materials:manage")`. This is an indexed lookup of current Platform state, not a permission copied
into JWT, BFF cookie or React state. Revocation therefore applies to the next protected operation.

`MembershipEntitlement` is independent, time-bounded access to closed content. It is not a role or
permission. UI personas are derived projections such as anonymous, Account without entitlement,
Account with entitlement, and Account with `materials:manage`.

## Persistence

The `accounts` PostgreSQL schema owns exactly:

- `accounts`: UUID, Logto issuer, Logto subject, nullable keyed email fingerprint, nullable unique
  opaque Telegram subject reference, creation time;
- `account_permissions`: exact Account/permission grants;
- `account_audit_events`: append-only redacted events.

Nullable email fingerprint supports both owner bootstrap and Telegram-only Accounts. No synthetic
email is created. The first verified owner email callback fills the fingerprint under the existing
duplicate-email rules.

Applied migration `0002_identity_principals` remains immutable history. Forward migration
`0004_accounts` preserves human mappings, converts either legacy Materials grant to
`materials:manage`, drops transient local session/idempotency/reauth data and removes the legacy
schema. Legacy service Principals are deliberately not migrated because no real M2M authorization
consumer exists.

## Owner release bootstrap

After migrations and before traffic, an explicit release job receives `OWNER_LOGTO_ISSUER` and
`OWNER_LOGTO_SUBJECT`. It idempotently ensures the Account and one selected permission:
`OWNER_PERMISSION` defaults to `materials:manage`; `communications:manage` requires that explicit
selection. It appends redacted audit facts including the granted permission. It is not a schema migration, application startup side effect or public HTTP
route. The Logto owner must exist before the release is promoted.

## Audit and privacy

Allowed account events are:

- `account_created`;
- `duplicate_identity_rejected`;
- `owner_bootstrap_completed`;
- `permission_granted`;
- `permission_revoked`.

Audit contains only event, time and opaque local Account ID when available. Raw email, issuer,
subject, JWT, claims, codes, cookies and provider responses are forbidden.

## BFF and logout

- Sign-in and callback use official `@logto/next` state/PKCE and encrypted cookie handling.
- The narrow audience-binding adapter remains until the pinned upstream SDK includes `resource` in
  authorization-code exchange.
- Callback validates the Logto flow, obtains one Platform-audience access JWT server-side and calls
  `POST /accounts`.
- Subsequent status/protected calls use the same SDK context and call `GET /accounts/current`.
- Logout delegates to official Logto sign-out. If provider cleanup fails, Platform clears the
  official local cookie and reports incomplete global logout.
- Custom `inside_session`, `inside_signin`, local session endpoints, sign-in attempt state,
  re-authentication routes and `inside_interactive_at` are absent.

Logto's built-in per-recipient resend limit and code lifetime are the initial abuse controls. A
CAPTCHA is not enabled until a separate regional availability proof, especially from Russian
networks.

## Deferred consumers

- Account/Profile nickname, avatar, management, disable/delete/recovery;
- MembershipEntitlement and ContentAccess implementation;
- authoring HTTP UI and MCP transport;
- custom step-up/re-authentication;
- technical M2M Account.

MCP will first authenticate with user-delegated OAuth as the owner Account. A technical identity is
introduced only with the first real independent business-authorization consumer.

## Verification

Required evidence:

- real-PostgreSQL first, returning and concurrent Account establishment;
- ordinary unknown identity does not provision;
- duplicate-email conflict creates no second Account and leaves redacted audit;
- exact issuer/audience/signature/time/subject JWT negative corpus and explicit algorithm allowlist;
- provider roles/scopes do not reach Account contract;
- current `materials:manage` grant/revoke lookup;
- idempotent owner bootstrap without raw email;
- migration replay/checksum/schema mapping;
- web callback/status/logout orchestration without custom auth cookies;
- repository typecheck, lint, tests, build and architecture guardrails.

## Stopping condition

The foundation is ready when one retained email-code journey establishes one Account, later
requests resolve it through the same Logto proof boundary, logout uses only official provider
semantics, and current Platform authorization facts are checked by their owning modules. This does
not declare production Logto operations, email delivery, backup, monitoring or incident response
ready.

## Telegram sign-in — Platform #299

The owner extended the email-only establishment rule on 2026-09-06 in
[Platform #299](https://github.com/sachkov-inside/platform/issues/299). Logto stays the sole session
issuer. `inside_telegram_sign_in` contains opaque `subjectRef` and `requestRef`, only for a fresh
verified interaction from the exact configured connector. Refresh tokens never create this claim.
The Nest verifier retains ES384, exact issuer/audience, lifetime and human-token checks.

The connector retains the browser secret in Logto interaction storage, checks state and expiry,
and consumes `inside.bot-sign-in.v1` once. The bot URL contains only the short-lived start token.
Provider status and proof are obtained server-to-server. A different browser cannot finish the
interaction. Account establishment serializes the Logto and Telegram identity keys; a conflict
never transfers ownership. The Logto fork also enforces unique Telegram identities in its own DB.

An email Account connects Telegram through the existing authenticated linking flow. On later bot
sign-in the provider supplies its confirmed link, and the trusted Logto connector resolves its
opaque principal through Platform before attaching the social identity to that exact Logto user.
Client-selected subjects, usernames and email coincidence are never ownership evidence.

The Account and stable linking principal are persisted before provider account-link finalization.
A lost response is repaired by retrying with the same principal, even when the old attempt expired.
Provider consume reserves an unlinked Telegram subject under a shared identity lock; ordinary
email linking cannot take it between proof consumption and finalization. The reservation survives
a lost response and a fresh bot proof repairs it. If email linking wins first, consume returns
that confirmed link instead. Linking does not issue Membership
or permissions. First email attachment to Telegram-only Accounts, merging, replacement and recovery
are excluded. The owner simplified the sign-in UI on 2026-09-06: one bot-opening action,
a short waiting status, and explicit “Подтвердить вход” / “Отменить” bot buttons. Approval automatically
returns the original browser to Platform. The screen omits account/recovery explanations and
number matching; this changes presentation, not browser binding or one-time proof checks.

`TELEGRAM_SIGN_IN_ENABLED` defaults off in Platform, connector provisioning and the provider.
Disabling blocks start, waiting, proof consumption and callback completion, including returning
Accounts. Ordinary session resolution and email remain unchanged. The local setup and synthetic
versus real message boundary are documented in
[`telegram-sign-in-local.md`](../verification/telegram-sign-in-local.md).

### Отдельный billing contact

[Billing contact #406](subscription-billing-v1.md#подтверждённый-контакт-и-согласия--406) проверяет
адрес для чеков и уведомлений уже вошедшего Account. Он не добавляет email identity в Logto,
не обновляет login fingerprint и не меняет описанные выше ограничения first email sign-in
attachment, merge или recovery. Коды контакта проходят через Platform; коды **входа** остаются в Logto.
