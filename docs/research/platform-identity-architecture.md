# Identity architecture for Sachkov Inside Platform

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-identity-architecture.md); текущие правила — [документы Platform](../../README.md).

**Status:** decision-grade research for [Workspace issue #33](https://github.com/sachkov-inside/workspace/issues/33)

**Snapshot:** 2026-08-21

**Decision owner:** product owner; this report is not an ADR

## Executive recommendation

Given the owner's conditional preference, make **Logto OSS the provisional v1 target**, with primary email verification code, optional password disabled initially, and the official Next.js App Router SDK as a BFF. NestJS accepts only audience-bound Logto access JWTs, maps `(iss, sub)` to the platform `Principal`, and evaluates Membership itself. This target passes only if the PoC clears four hard gates: redirect-based branded login is acceptable; the official self-host footprint fits the chosen VPS; the single-admin/no-Console-MFA OSS boundary is acceptable and mitigated; and Yandex plus backup/restore work end to end.

Logto is the stronger architectural fit when standard OIDC clients, multi-app SSO, machine clients, and Inside acting as an OAuth/OIDC provider are credible roadmap items. It already supplies those seams instead of asking the application to grow into an authorization server ([third-party OAuth/OIDC apps](https://docs.logto.io/integrate-logto/third-party-applications), [M2M](https://docs.logto.io/quick-starts/m2m)).

Keep **Better Auth as the explicit fallback and the smaller pure-v1 choice**. It should win if inline Next.js credential forms are non-negotiable, if the actual VPS cannot carry Logto's published minimum, if the OSS admin-security limitation is unacceptable, or if the provider/SSO roadmap remains uncommitted. Better Auth provides email OTP, Yandex, database sessions and an emerging OAuth-provider plugin without a separate identity service ([sessions](https://better-auth.com/docs/concepts/session-management), [email OTP](https://better-auth.com/docs/plugins/email-otp), [generic OAuth/Yandex](https://better-auth.com/docs/plugins/generic-oauth), [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)). Keep **WorkOS AuthKit** only as the managed alternative if the owner later prefers outsourcing identity operations and accepts its Yandex/export blockers.

The recommendation does **not** move Membership authorization into any identity product.

## The boundary that must not move

Authentication establishes *who* is making a request. Identity federation links that person to upstream identities. Sessions and tokens carry authentication state. Application authorization decides *what that person may do*. OAuth itself is an authorization framework, not an application Membership model ([Passport OAuth 2.0 concepts](https://www.passportjs.org/concepts/oauth2/authentication/)).

The platform should own this minimum model:

```text
Auth system                        Platform database
-----------                        -----------------
stable issuer + subject  ------->  Principal(id, issuer, subject, email_snapshot, status)
                                    |
                                    +-- MembershipAccess(...)
                                    +-- TelegramLink(...)
                                    +-- audit/application data
```

- Resolve users by `(issuer, subject)`, never by mutable email.
- Treat email as contact/display data and as one possible verified credential, not as the durable application key.
- Keep `MembershipAccess` and Telegram entitlement checks in NestJS/application data. IdP roles, groups, organizations, or token claims must not grant Membership access.
- Link Telegram only after the platform session has authenticated the user. Telegram linking is a separate proof and association, not the primary login method.
- Represent MCP, background jobs, and future integrations as service principals with audience-scoped machine credentials. Never reuse a browser session or a member entitlement.
- On every protected request: authenticate credential → resolve `Principal` → evaluate application policy/current entitlement → access data.

This seam makes an identity migration a remapping of subjects and credentials, not a rewrite of product authorization.

## Decision gates

The options were assessed against these gates, in order:

1. Primary email OTP and/or password for v1; secure recovery, rate limiting, and enumeration resistance.
2. Clean Next.js UX/BFF and NestJS enforcement without tokens in browser storage.
3. Direct Yandex OAuth 2.0 support or a bounded adapter. Yandex documents OAuth 2.0 authorization code with PKCE and user-info endpoints; OIDC-only upstream support is insufficient ([Yandex OAuth](https://yandex.ru/dev/id/doc/en/concepts/ya-oauth-intro), [authorization code/PKCE](https://yandex.ru/dev/id/doc/en/codes/code-url), [user information](https://yandex.com/dev/id/doc/en/user-information)).
4. Safe account linking that does not equate an unverified email with identity.
5. A credible path to passkeys/MFA, multiple applications, standard OIDC clients, machine clients, and Inside acting as an OAuth/OIDC provider.
6. Data ownership, documented exit, one-VPS operational fit, backup/restore, license, and paid-feature boundaries.

`Strong` means first-class and documented now; `Partial` means beta, paid, adapter/custom UI, or an important missing flow; `No` means a separate product or substantial implementation is required.

## Capability matrix

| Option | Class | v1 email | Passkey / MFA | Yandex / custom upstream | Linking | Inside as OAuth/OIDC provider; SSO; machines | Next.js + NestJS fit | Result |
|---|---|---|---|---|---|---|---|---|
| **Better Auth** | Embedded library | **Strong:** password + primary email OTP | **Strong:** plugins; 2FA does not automatically wrap every passwordless/social flow | **Strong:** generic OAuth includes `yandex()` | **Strong:** explicit linking and implicit-link controls | **Strong/young:** OAuth 2.1/OIDC plugin includes refresh, `client_credentials`, introspection and dynamic registration | Next integration is official; Nest integration is beta/community-maintained, so mount the core handler directly and prove it | **Finalist; smaller fallback** |
| **Logto OSS** | Self-hosted IdP | **Strong:** password + email verification code | **Strong:** passkey, TOTP/email/SMS MFA | **Strong:** generic OAuth 2.0 connector | **Strong:** re-authenticated Account API | **Strong:** native OAuth/OIDC IdP, multi-app SSO, third-party apps and M2M | Official Next App Router SDK and Nest JWT-protection guide | **Provisional target, subject to PoC gates** |
| **WorkOS AuthKit** | Managed IdP | **Strong:** password + 6-digit Magic Auth | **Strong:** passkeys (hosted UI) + TOTP | **Partial:** fixed social list; no Yandex/generic OAuth connector documented | **Strong:** verified-email automatic linking | **Strong:** Connect exposes OAuth/OIDC and separate M2M clients | Excellent Next BFF SDK; Nest verifies standard JWTs | **Finalist only if managed is preferred** |
| SuperTokens | Embedded SDK + self-hosted core | **Strong:** password, email OTP/magic link | Passkey core; **MFA paid** | **Strong:** custom OAuth/OIDC | **Paid:** automatic/manual account linking | **Paid/contact sales:** unified login/provider and M2M | Official Nest integration; more moving parts than Better Auth | Reject: future path crosses multiple paid boundaries |
| ZITADEL | Self-hosted/managed IdP | **Partial:** password first factor; email OTP is documented as MFA, primary email code needs custom Login UI/Session API | **Strong** | **Partial:** generic upstream is OIDC; Yandex OAuth-only needs custom work | **Strong** | **Strong:** OIDC/SAML, SSO, service accounts, dynamic clients | Standard Next PKCE/API JWT; hosted/custom Login App | Reject for v1: login mismatch, AGPL review, heavier footprint |
| Keycloak | Self-hosted IdP | **Partial:** password; no first-class primary email-code flow documented, so use an authenticator SPI/extension | **Strong:** OTP + WebAuthn/passkeys | **Partial:** OIDC/SAML broker; OAuth-only Yandex needs provider SPI | **Strong** | **Strong:** mature OIDC/SAML, service accounts and `client_credentials` | Standard OIDC integration; JVM/realm administration overhead | Reject for v1: operationally heavy and custom OTP/Yandex work |
| Ory Kratos + Hydra | Modular self-hosted/managed IAM | **Strong:** password, email/SMS OTP | **Strong:** passkeys/WebAuthn + TOTP | **Partial:** Kratos social is OIDC; Yandex needs adapter | **Strong** | **Strong:** Hydra is a certified OAuth/OIDC server with M2M, but needs our login/consent app | Headless and flexible, but at least two services plus UI/integration code | Reject for v1: too many owned seams |
| Auth0 | Managed IdP | Password/passwordless supported; primary OTP on a database connection is Early Access | **Strong** | **Strong:** custom OAuth 2.0 connections | **Partial:** application UX and plan constraints | **Strong:** mature authorization server and M2M | Strong Next SDK; Nest standard JWT | Reject: v1 flow maturity, cost tiers, support-gated credential exit |
| Clerk | Managed identity | **Strong:** password + email code | **Strong** | **Partial:** custom upstream must be OIDC-compatible; Yandex needs proxy/adapter | **Strong:** verified-email linking | OAuth/OIDC provider is available; machine tokens exist, but standard OAuth `client_credentials` is not supported | Excellent Next integration; Nest verifies JWT | Good managed alternative, but Yandex/M2M gaps |
| Supabase Auth | Managed/self-hosted auth server | **Strong:** password + email OTP/magic link | TOTP; passkeys are **Experimental** | **Strong:** generic OAuth 2.0/OIDC | Automatic; manual linking beta | Provider is **beta** and lacks `client_credentials` | Next SSR cookie guidance; Nest uses stateless bearer JWT | Capable, but experimental roadmap and unnecessary Supabase stack coupling |
| NestJS + Passport DIY | Application code | **Build it:** Nest sample is basic password→JWT only | **Build it** | OAuth/OIDC client strategies exist | **Build it** | **No:** Passport is not an OAuth/OIDC provider | Native Nest control, but every security lifecycle becomes ours | Reject: highest security and maintenance burden |

Material capability sources: Better Auth ([Next.js](https://better-auth.com/docs/integrations/next), [NestJS beta](https://better-auth.com/docs/beta/integrations/nestjs), [passkeys](https://better-auth.com/docs/plugins/passkey), [2FA](https://better-auth.com/docs/plugins/2fa), [linking options](https://better-auth.com/docs/reference/options)); Logto ([end-user flows](https://docs.logto.io/end-user-flows), [generic OAuth](https://docs.logto.io/integrations/oauth2), [Next App Router](https://docs.logto.io/quick-starts/next-app-router), [NestJS](https://docs.logto.io/api-protection/nodejs/nestjs), [third-party apps](https://docs.logto.io/integrate-logto/third-party-applications), [M2M](https://docs.logto.io/quick-starts/m2m)); WorkOS ([auth model](https://workos.com/docs/authkit/modeling-your-app), [passkeys](https://workos.com/docs/authkit/passkeys/passkey-configuration/multi-factor-auth), [identity linking](https://workos.com/docs/authkit/identity-linking), [social providers](https://workos.com/docs/authkit/social-login), [Connect](https://workos.com/docs/authkit/connect)); SuperTokens ([auth methods](https://supertokens.com/docs/authentication/overview), [custom providers](https://supertokens.com/docs/authentication/social/custom-providers), [account linking](https://supertokens.com/docs/post-authentication/account-linking/introduction), [unified login](https://supertokens.com/docs/authentication/unified-login/introduction)); ZITADEL ([Login App](https://zitadel.com/docs/guides/integrate/login-ui/login-app), [account linking](https://zitadel.com/docs/concepts/features/account-linking), [applications](https://zitadel.com/docs/guides/manage/console/applications-overview)); Keycloak ([Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/)); Ory ([Kratos](https://www.ory.com/kratos), [Hydra](https://www.ory.com/hydra)); Auth0 ([passwordless](https://auth0.com/docs/authenticate/passwordless), [custom OAuth](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/oauth2), [M2M](https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-credentials-flow)); Clerk ([auth strategies](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [custom provider](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider), [OAuth server](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth), [machine auth boundary](https://clerk.com/docs/guides/development/machine-auth/overview)); Supabase ([Auth](https://supabase.com/docs/guides/auth), [custom providers](https://supabase.com/docs/guides/auth/custom-oauth-providers), [provider limits](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows), [passkeys](https://supabase.com/docs/guides/auth/passkeys)); Nest/Passport ([Nest authentication](https://docs.nestjs.com/security/authentication), [Passport sessions](https://www.passportjs.org/concepts/authentication/sessions/)).

## Ownership, operations, licensing, and exit

| Option | Data/schema and exit | Self-host footprint / HA / backup | License and published price boundary | Lock-in assessment |
|---|---|---|---|---|
| **Better Auth** | Auth tables and credentials are in our PostgreSQL; schema/migrations are documented. Export is ordinary database migration, but plugin-version compatibility must be tested. | No separate identity service; shares NestJS and PostgreSQL. Scale Nest replicas against shared DB. Back up DB, auth configuration, encryption/signing secrets. | MIT; framework is free. Optional Better Auth infrastructure starts at `$20/month`. | **Low**, provided we never leak Better Auth schema into product modules and test a synthetic export/import. |
| **Logto OSS** | Self-hosted database and Management API are under our control. Bulk/JIT import exists; no lossless logical export or self-service Cloud↔OSS migration is documented, so test exit explicitly. | One image exposes core + Admin, plus dedicated PostgreSQL and persistent connector code. Official minimum: 2 vCPU, 8 GiB RAM, 256 GiB disk. Multi-instance needs shared connectors and a single alteration job. | MPL-2.0 OSS. Cloud Free up to 50K MAU; Pro starts at `$24/month`; packaged custom UI, built-in email, multi-admin/Console MFA and other conveniences are Cloud-only. | **Low–medium** self-hosted; standard OIDC limits application coupling, but credential/factor portability and operator security need explicit drills. |
| **WorkOS AuthKit** | Vendor owns the credential store. Password-hash import is documented; outgoing password-hash export was not found in official docs. Make it a contractual go/no-go. | No self-hosted runtime; vendor runs HA/backup. The application still needs outage/error policy and depends on network/vendor availability. | Proprietary. AuthKit advertises up to 1M users free, then `$2,500` per additional million; enterprise SSO starts at `$125/connection/month`. | **Medium–high** until identity/profile/hash export is contractually confirmed. |
| SuperTokens | Self-hosted core DB; official account/session migration paths. | Core service + SDKs + PostgreSQL. | Community core is Apache-2.0; enterprise directory separately licensed. MFA and linking each have `$100/month` minimums; unified login/M2M are sales-led. | Medium: protocol and key future features sit in paid product. |
| ZITADEL | Self-host DB, but official export omits passkeys, global factors/policies, keys/PATs and event history. | Compose includes proxy, API, Login and PostgreSQL; documentation states at least 2 GB RAM. Production HA guidance moves toward orchestrated multi-instance deployment. | AGPL-3.0-only core or separate commercial license; Cloud/commercial self-host plans are priced separately. | Medium: rich model plus incomplete portable export; license needs legal decision. |
| Keycloak | Realm JSON export is not a backup and excludes live sessions/events/revocations; DB backup is authoritative. | JVM/Quarkus service + PostgreSQL; true HA adds multiple nodes and distributed caches. | Apache-2.0; no software fee. | Low vendor lock-in, high operational and extension ownership. |
| Ory Kratos + Hydra | Self-hosted DBs and documented credential migration/export. | At least Kratos, Hydra, PostgreSQL, and our login/consent UI; separate keys and backups. | Both Apache-2.0. Managed production is advertised from roughly `$770/year`; enterprise self-host is custom. | Low data lock-in, high architecture/operations surface. |
| Auth0 | Profile export exists; password hashes and MFA secrets require support, eligibility review, and approval. | Managed only, including Private Cloud. | Proprietary; Free up to 25K MAU, with feature/MAU tiers above it. | High credential-exit and pricing-plan dependence. |
| Clerk | Hosted credential store, but documented export includes password hashes. | Managed only. | Proprietary; Hobby up to 50K MRU; Pro starts at `$20/month` billed annually. | Medium: good managed exit story, runtime remains vendor-dependent. |
| Supabase Auth | Self-host DB is under our control; official repo warns consumers not to depend on internal auth schema. | Standalone GoTrue is possible, but supported self-host guidance assumes a broader Supabase stack; backup/HA are operator-owned. | Auth server MIT; managed Free includes 50K MAU and Pro starts at `$25/month`. | Low–medium self-hosted; higher if product code couples to Supabase internals. |
| NestJS + Passport DIY | Complete schema/control and no vendor exit. | No separate service, but every security migration, key, session, audit and recovery mechanism is ours. | MIT components; engineering/security cost dominates. | No vendor lock-in; maximum bespoke-code lock-in and security liability. |

Sources for deployment, license, cost, and exit: Better Auth ([PostgreSQL](https://better-auth.com/docs/adapters/postgresql), [pricing](https://better-auth.com/pricing)); Logto ([OSS limits](https://docs.logto.io/logto-oss), [deployment](https://docs.logto.io/logto-oss/deployment-and-configuration), [migration](https://docs.logto.io/user-management/user-migration), [pricing](https://logto.io/pricing)); WorkOS ([pricing](https://workos.com/pricing), [migration in](https://workos.com/docs/migrate/other-services)); SuperTokens ([license](https://github.com/supertokens/supertokens-core/blob/master/LICENSE.md), [self-host](https://supertokens.com/docs/deployment/self-host-supertokens), [pricing](https://supertokens.com/pricing), [migration](https://supertokens.com/docs/migration/overview)); ZITADEL ([licensing](https://github.com/zitadel/zitadel/blob/main/LICENSING.md), [Compose](https://zitadel.com/docs/self-hosting/deploy/compose), [export limitations](https://zitadel.com/docs/guides/migrate/sources/zitadel)); Keycloak ([license](https://github.com/keycloak/keycloak/blob/main/LICENSE.txt), [production configuration](https://www.keycloak.org/server/configuration-production), [import/export](https://www.keycloak.org/server/importExport)); Ory ([Kratos license](https://github.com/ory/kratos/blob/master/LICENSE), [Hydra license](https://github.com/ory/hydra/blob/master/LICENSE), [pricing](https://www.ory.com/pricing), [migration](https://www.ory.com/migration)); Auth0 ([deployment](https://auth0.com/docs/deploy-monitor/deployment-options), [pricing](https://auth0.com/pricing), [hash/MFA export](https://auth0.com/docs/manage-users/user-migration/export-password-hashes-and-mfa-secrets)); Clerk ([pricing](https://clerk.com/pricing), [migration/export](https://clerk.com/docs/guides/development/migrating/overview)); Supabase ([license](https://github.com/supabase/auth/blob/master/LICENSE), [self-hosting](https://supabase.com/docs/guides/self-hosting), [pricing](https://supabase.com/pricing)). Prices and tier boundaries are volatile; re-check them before procurement.

FusionAuth and authentik were not added to the matrix: neither closes a shortlist gap that is not already covered by Better Auth (embedded), Logto/Keycloak (self-hosted IdP), and WorkOS/Clerk/Auth0 (managed). Adding more products would increase PoC breadth without changing the decision boundary.

## Finalists and concrete topologies

### 1. Better Auth — smallest v1 and explicit fallback

```text
Browser
  | Secure, HttpOnly, SameSite cookie; no token in localStorage
  v
one public origin / reverse proxy
  |-- Next.js: pages, RSC, forms, authenticated application UX
  `-- /api/* -> NestJS
          |-- /api/auth/* -> Better Auth handler
          |-- AuthGuard -> Better Auth getSession -> Principal lookup
          `-- application policy -> MembershipAccess / TelegramLink
                              |
                         PostgreSQL
                 auth schema + platform schema
```

- NestJS is the sole owner of auth configuration, email delivery callbacks, secrets and auth tables. Do not run a second Better Auth server inside Next.js.
- Route both UI and API through one origin so the browser gets a first-party cookie and the deployment avoids CORS/cross-site-cookie complexity.
- Use a database-backed opaque session initially. Better Auth also supports signed cookie caching/stateless sessions, but those complicate immediate revocation; add them only after measurement ([session modes](https://better-auth.com/docs/concepts/session-management)).
- Next.js server components should call an application endpoint such as `/api/me`; explicitly forward the incoming cookie on server-side calls. Client components use same-origin credentials.
- NestJS auth guard resolves the session through Better Auth's server API, then resolves the app `Principal`. It must not query Better Auth internal tables directly.
- Use generic OAuth for Yandex and require the Yandex stable subject; missing/unverified email must enter an explicit linking/collection flow rather than auto-linking.
- If the provider plugin is adopted, require `@better-auth/oauth-provider >= 1.6.11`; an earlier authorization-code validation issue is recorded in the project's official advisory ([GHSA-7w99-5wm4-3g79](https://github.com/better-auth/better-auth/security/advisories/GHSA-7w99-5wm4-3g79)). The legacy OIDC provider plugin must not be used.

Primary risk: the official Nest integration is currently beta and community-maintained. The PoC therefore proves the framework-agnostic handler/session seam and avoids making that adapter a required architecture component.

### 2. Logto OSS — provisional target and deep dive

```text
Browser
  | 1. /sign-in route; OIDC authorization request
  v
Next.js App Router BFF ---------------------------> auth.inside.example
  | @logto/next                                       | reverse proxy
  | encrypted HttpOnly app-session cookie             | Logto core + hosted experience
  | 4. callback: validate state/code, exchange tokens  | Yandex + email connectors
  |                                                   `-> dedicated PostgreSQL database
  | 5. server-only audience-bound access JWT
  v
NestJS -> JWKS signature + iss/aud/exp validation -> Principal(iss, sub)
  `-> application policy -> MembershipAccess / TelegramLink

Future: other apps -> separate OIDC clients -> shared Logto SSO
        MCP/jobs -> client_credentials -> service Principal -> NestJS scope
        partner apps -> consented third-party OAuth/OIDC clients
```

#### Direct answer: how customizable is login?

Logto can be fully branded, but **Logto OSS does not offer a supported headless sign-in API that lets a Next.js page submit passwords or email codes directly**. The documented security model is authorization-code redirect to a Logto-hosted experience and redirect back. Direct sign-in can skip the universal page for a social provider, and authentication parameters can prefill an email or select the first screen, but credential verification still occurs in the Logto interaction ([sign-in experience](https://docs.logto.io/concepts/sign-in-experience), [authentication parameters](https://docs.logto.io/end-user-flows/authentication-parameters), [email sign-in FAQ](https://docs.logto.io/end-user-flows/sign-up-and-sign-in/sign-in)). Do not iframe the experience or call Experience API from an ordinary Next.js page; neither is a documented integration.

| Level | What Inside can change | Where it runs | Cost and transferred responsibility | v1 decision |
|---|---|---|---|---|
| **A. Configuration and branding** | Email-code/password ordering, sign-up fields, social/passkey/MFA choices, logo, colors, favicon, dark mode, localized content and terms | Prebuilt UI at the Logto auth origin | Logto owns all flow states, recovery, CAPTCHA, accessibility and protocol behavior | **Recommended** |
| **B. Custom CSS** | Visual layout/details in addition to Level A; CSS only, no HTML or JavaScript | Prebuilt UI at the Logto auth origin | We own regression testing against Logto markup. Sign-in uses CSS Modules and documented examples rely on partial class matching, so upgrades can break selectors | Use only a small token-like stylesheet; no DOM surgery |
| **C. App entry + direct sign-in** | Render Inside-styled email/Yandex CTAs in Next.js; use `login_hint`, `first_screen`, or `direct_sign_in` | CTA is inline; authentication still redirects through Logto/Yandex | We own routing and continuity, while Logto still owns credentials and interaction state | Good for a seamless Yandex button; email still lands on Logto |
| **D. Bring your UI** | Replace HTML/CSS/JavaScript with a custom SPA using Experience API for sign-up, sign-in, reset, social binding, MFA and CAPTCHA | Uploaded and hosted at the **Logto Cloud** auth origin, not inline in Next.js | We own every screen, error state, accessibility, localization, browser testing, CAPTCHA integration, CSP dependencies and compatibility with Experience API | **Not available as a packaged OSS feature; not v1** |
| **E. OSS experience fork** | Fork the open-source `packages/experience` UI and rebuild Logto | Self-hosted Logto auth origin | Adds a permanent security-sensitive fork, merge work on every Logto upgrade and full flow regression burden | Reject unless branding cannot be met by A–C |

Brand colors, logos and app/organization-specific variants are first-class ([brand customization](https://docs.logto.io/customization/match-your-brand)). Custom CSS supports CSS only and documents the CSS Modules selector caveat ([custom CSS](https://docs.logto.io/customization/custom-css)). Cloud Bring your UI accepts a built SPA ZIP and exposes the session-bound Experience API, but Logto explicitly lists it as Cloud-only; OSS may fork the experience source instead ([Bring your UI](https://docs.logto.io/customization/bring-your-ui), [OSS feature boundaries](https://docs.logto.io/logto-oss)). Experience API is therefore an implementation API for a UI executing in Logto's authentication interaction—not a general replacement for the OIDC redirect or a safe credential API for the application origin.

For v1, use Level A plus minimal Level B on `auth.inside.example`, and optionally a Level C Yandex button. The browser will visibly change origin, but the custom domain and matching branding make the transition intentional. If product requires the email/code fields themselves to remain inside a Next.js page/modal, choose Better Auth.

#### v1 sign-up, sign-in, linking, and recovery

- Configure email as the required sign-up identifier. Logto requires email verification during email sign-up; creating a password is optional. Configure email verification code as the only initial sign-in factor. Password can later be enabled as an alternative and reordered without changing application code ([email sign-in configuration](https://docs.logto.io/end-user-flows/sign-up-and-sign-in/sign-in), [email connectors](https://docs.logto.io/connectors/email-connectors)).
- Self-hosted OSS does not include Logto's built-in email service. Use the official SMTP connector or HTTP email connector to an Inside-owned delivery adapter. Configure distinct `Register`, `SignIn`, `ForgotPassword`, `BindNewIdentifier`, and security-verification templates. Codes expire after a fixed 10 minutes; the expiry is not currently configurable ([email templates](https://docs.logto.io/connectors/email-connectors/email-templates), [SMTP](https://docs.logto.io/integrations/smtp), [HTTP email](https://docs.logto.io/integrations/http-email)).
- With email-code-only login there is no forgotten-password flow. Loss of the email account becomes a manual recovery policy decision. If password is enabled, Logto supports forgot-password via email verification code ([password reset](https://docs.logto.io/end-user-flows/sign-up-and-sign-in/reset-password)). Recovery must never use Telegram Membership status as sufficient identity proof.
- Email verification code cannot be both the primary sign-in factor and the email MFA factor for the same flow. If v1 uses email code for primary authentication, future MFA should start with passkey/WebAuthn, TOTP or backup codes rather than counting the same mailbox twice ([email MFA](https://docs.logto.io/end-user-flows/mfa/email-mfa), [passkey sign-in](https://docs.logto.io/end-user-flows/sign-up-and-sign-in/passkey-sign-in)).
- Disable automatic social linking for v1. Logto supports automatic matching and a user-confirmed manual flow, but an email collision is account-takeover-sensitive. Prefer explicit linking from an authenticated account through Account Center/Account API with recent password or email-code verification ([social linking](https://docs.logto.io/end-user-flows/sign-up-and-sign-in/social-sign-in), [Account API](https://docs.logto.io/end-user-flows/account-settings/by-account-api)).
- Use the prebuilt Account Center first. It verifies the current identity before sensitive email/password/MFA changes and can be branded; a custom Inside settings page can later call Account API through NestJS/BFF without using the administrative Management API in the browser ([Account Center](https://docs.logto.io/end-user-flows/account-settings/by-account-center-ui)).

#### Yandex through the generic OAuth connector

The official generic OAuth 2.0 connector accepts authorization, token and user-info endpoints, uses authorization-code grant, permits a custom scope string, and maps vendor fields to `id`, `name`, `avatar`, `email`, and `phone`; only `id` is mandatory ([generic OAuth connector](https://docs.logto.io/integrations/oauth2)). The initial PoC configuration is:

```json
{
  "authorizationEndpoint": "https://oauth.yandex.com/authorize",
  "tokenEndpoint": "https://oauth.yandex.com/token",
  "userInfoEndpoint": "https://login.yandex.ru/info?format=json",
  "tokenEndpointResponseType": "json",
  "tokenEndpointAuthMethod": "client_secret_post",
  "scope": "login:info login:email",
  "profileMap": { "id": "id", "email": "default_email", "name": "display_name" }
}
```

Map Yandex's durable account `id`—not email—as the social subject ([Yandex authorization code](https://yandex.ru/dev/id/doc/en/codes/code-url), [Yandex user information](https://yandex.com/dev/id/doc/en/user-information)). Prove the live callback rather than treating this draft as configuration truth: Yandex returns bearer token metadata while its user-info examples use an `OAuth` authorization scheme, so connector/user-info interoperability is a go/no-go test. If the generic connector fails, OSS supports installing a custom connector artifact, but that adds code and upgrade ownership ([manage connectors](https://docs.logto.io/logto-oss/using-cli/manage-connectors)).

The PoC must prove the exact callback and email semantics. Logto only promotes verified social emails to `primary_email`, while the generic OAuth mapping documented above has no `email_verified` mapping. If Yandex does not provide a verifiable signal that Logto accepts, require the user to enter and verify an email in Logto; never auto-link on the returned Yandex email. Do not enable third-party token storage unless the product needs Yandex APIs after login; if enabled, configure and back up `SECRET_VAULT_KEK` because it protects the Secret Vault ([user data](https://docs.logto.io/user-management/user-data), [Secret Vault configuration](https://docs.logto.io/logto-oss/deployment-and-configuration)).

#### Exact Next.js App Router BFF flow

1. Register Inside as a **Traditional Web** application. Store its app secret and a ≥32-character `cookieSecret` only on the Next.js server. Configure the public `baseUrl`, Logto `endpoint`, exact callback and post-sign-out URI.
2. A dedicated `/sign-in` route or Server Action calls `signIn()`. The SDK creates the OIDC authorization request and redirects to Logto. Login is intentionally redirect-based and enables Logto SSO.
3. Logto authenticates and returns an authorization code. `app/callback/route.ts` calls `handleSignIn()`; the SDK completes the code exchange and writes encrypted session data to an `HttpOnly`, `Secure` production cookie.
4. Server Components call `getLogtoContext()` for identity display only. Browser code never receives the refresh token or access token.
5. Register `https://api.inside.example` as a Logto API resource. In a Next route handler/Server Action, call `getAccessToken()` for that resource and forward it server-to-server to NestJS. Do not return or log it. Use a technical scope only if needed for coarse API admission; Membership remains a database decision.
6. On sign-out, clear the BFF session and redirect through Logto logout so its shared SSO session is also ended.

The SDK stores encrypted session data in the cookie by default and can use a custom `sessionWrapper` for Redis/database storage. There is a specific App Router limitation: `getAccessTokenRSC()` can refresh an expired token but RSC cannot persist the refreshed token to the cookie, causing repeated refreshes. For v1, fetch Nest data through BFF route handlers/Server Actions that can update cookies; add external session storage only if cookie size, multiple organization sessions, or measured refresh churn requires it ([official App Router guide](https://docs.logto.io/quick-starts/next-app-router)).

#### NestJS authentication and scopes

NestJS should discover the issuer and JWKS, then validate the JWT signature, exact `iss`, exact API-resource `aud`, `exp`, and required technical scope. Return 401 for a missing/invalid credential and 403 only after a valid credential lacks a required technical scope. Logto's official Nest guide documents those checks and the distinct user/M2M claims ([NestJS JWT guide](https://docs.logto.io/api-protection/nodejs/nestjs)).

After token validation:

- user token: map `(iss, sub)` to a user `Principal`;
- `client_credentials` token: map the application/client subject to a service `Principal` and require a machine-only scope;
- resolve current `MembershipAccess` and resource ownership from the platform database;
- ignore Logto roles/organizations for Membership. A broad technical `inside:api` scope means “this client may address this API,” not “this user is a member.”

#### Logto as provider, multi-app SSO, and M2M

Logto is already an OIDC/OAuth authorization server. First-party web/native apps get separate clients and share the Logto SSO session. Third-party applications use authorization code (PKCE for public clients), consent, profile/API scopes, refresh tokens and device flow where appropriate ([third-party apps](https://docs.logto.io/integrate-logto/third-party-applications), [permission management](https://docs.logto.io/integrate-logto/third-party-applications/permission-management)). M2M applications use `client_credentials`, a target `resource`, and scopes; the M2M `sub` is the app ID and cannot impersonate a user ([M2M guide](https://docs.logto.io/quick-starts/m2m)).

For v1, create only two clients: the Next traditional web client and one staging M2M client for the proof. Do not model Membership in Logto RBAC. Add partner clients, consent copy, client registration governance and machine credential rotation only when a real consumer exists.

#### OSS boundaries and production operations

Logto OSS is MPL-2.0 and supports most core identity/protocol features without MAU fees, but official docs reserve these conveniences for Cloud: multiple Console tenants, collaborator invitations, MFA for administrators signing into Console, Protected App, built-in email, packaged Bring your UI, IdP-initiated SSO, unrestricted SAML applications, and hiding the Logto mark. OSS allows only one initial administrator and does not support multiple administrators ([OSS boundaries](https://docs.logto.io/logto-oss), [OSS setup](https://docs.logto.io/logto-oss/get-started-with-oss)). This limitation concerns the operator Console, not MFA/multi-tenancy for Inside end users.

Cloud is not feature-equivalent at the advertised `$24` base: current Pro add-ons include `$8/month` per additional M2M app, `$8/month` per third-party app, `$48/month` for MFA, `$32/month` for RBAC, `$48/month` for organizations and `$48/month` per enterprise SSO connection; published limits and prices can change ([Cloud billing](https://docs.logto.io/logto-cloud/billing-and-pricing)). Those Cloud charges do not apply to the corresponding core OSS end-user features, but OSS transfers infrastructure and operator security to Inside.

The official **minimum recommended** self-host hardware is **2 vCPU, 8 GiB RAM, and 256 GiB disk**. Treat this as a hard capacity gate for the current one-VPS plan, then record measured idle/login-load CPU, RSS and DB growth in the PoC. The demo Compose file is explicitly not production-safe: its bundled PostgreSQL is ephemeral across re-creation. Production should use a pinned Logto image, persistent connector volume, and a dedicated PostgreSQL 14+ database ([OSS setup](https://docs.logto.io/logto-oss/get-started-with-oss), [deployment](https://docs.logto.io/logto-oss/deployment-and-configuration)).

Recommended deployment details:

- TLS reverse proxy exposes `auth.inside.example` → core port 3001 and keeps Admin port 3002 private behind VPN/IP allowlist; set `TRUST_PROXY_HEADER=1`, stable `ENDPOINT`, and a separate private `ADMIN_ENDPOINT`. `ENDPOINT` changes the OIDC issuer, so choose it before production.
- Configure a real SMTP/HTTP email connector, SPF/DKIM/DMARC, delivery monitoring, and a persistent/shared connectors directory. The Cloud-only built-in email connector is not available.
- Use a dedicated Logto database, not the platform application schema. Product code must use OIDC, Account API, or Management API—not Logto tables.
- Back up the entire Logto PostgreSQL database off-host because it contains identities, grants, audit events, cookie keys and OIDC private keys; also back up the versioned environment/configuration, connector code/volume, email templates, reverse-proxy config and `SECRET_VAULT_KEK`. Follow PostgreSQL physical/logical backup procedures and prove restore; Logto has no dedicated official lossless backup/restore runbook ([Logto database configuration](https://docs.logto.io/concepts/core-service/configuration), [PostgreSQL backup](https://www.postgresql.org/docs/current/backup.html)).
- Pin versions. Before an upgrade, back up; upgrade the matching CLI/image; run database alteration exactly once; then restart/swap the app. Logto states alterations keep the old app schema-compatible during rollout, but this claim must be verified for the selected versions ([OSS upgrades](https://docs.logto.io/logto-oss/upgrading-oss-version), [database alteration](https://docs.logto.io/logto-oss/using-cli/database-alteration)).
- Keep the Admin endpoint off the public Internet. Because OSS has one administrator and no Console MFA, record all proxy access, protect recovery credentials offline, and require a two-person operational procedure for production changes.

Logto audit logs cover authentication interactions, IP, user agent, app, user and timestamp, but **do not record Management API operations**; OSS operators must schedule cleanup of old audit rows. Supplement them with reverse-proxy/admin access logs, Nest application-security audit, PostgreSQL/container metrics, email delivery metrics and synthetic checks of discovery/JWKS/login/callback ([audit logs](https://docs.logto.io/developers/audit-logs)). Signed webhooks can synchronize `User.*` changes and expose delivery health/retries, but are asynchronous and cannot decide the current login ([webhooks](https://docs.logto.io/developers/webhooks)). `GET /api/status` returns 204 but does not prove dependencies healthy, so it is only a liveness signal ([status API](https://openapi.logto.io/operation/operation-getstatus)). No first-party Prometheus/metrics integration was found in the official docs reviewed for this snapshot; validate the operational telemetry surface in the PoC.

#### Data export and migration

Logto documents bulk and just-in-time **imports**, including compatible password hashes, through Management API ([user migration](https://docs.logto.io/user-management/user-migration)). The user-list API can include password digest/algorithm and identity profiles, which makes a scripted credential export plausible ([List users API](https://openapi.logto.io/dev/operation/operation-listusers)). It is still not a one-command, lossless tenant export of factors/passkeys, sessions, clients, connectors, keys and every configuration. Cloud↔OSS self-service migration is explicitly unsupported; Cloud export requires contacting Logto ([tenant migration](https://docs.logto.io/logto-cloud/tenant-settings)).

For self-hosted disaster recovery, the PostgreSQL backup is authoritative. For a future product migration, build a synthetic Management API export and document what cannot be reconstructed; a raw database dump may preserve Logto but is not automatically a portable contract for another IdP. The platform's independent `(issuer, subject) -> Principal` mapping limits product-data migration, but password/passkey re-enrollment may still be required.

Primary Logto risks are therefore concrete: redirect rather than inline credentials; Cloud-only packaged custom UI; a security-sensitive fork for full OSS UI replacement; published 8 GiB/256 GiB minimum; single Console admin without MFA; no documented complete portable export; incomplete Management API audit; and the Next RSC refresh-persistence limitation. None is fatal if accepted explicitly and proven before implementation.

### 3. WorkOS AuthKit — managed finalist

```text
Browser -> Next.js AuthKit SDK/BFF -> WorkOS Hosted UI/AuthKit
             | encrypted HttpOnly session cookie
             | access JWT
             v
           NestJS -> WorkOS JWKS validation -> Principal -> Membership

Future: WorkOS Connect -> OAuth/OIDC clients and M2M apps
```

- The official Next.js SDK keeps the session in an encrypted cookie and handles code exchange/refresh ([AuthKit Next.js SDK](https://workos.com/docs/sdks/authkit-nextjs), [sessions](https://workos.com/docs/authkit/sessions)).
- NestJS validates access tokens locally against vendor JWKS and maps `(iss, sub)` to `Principal`; no Membership role comes from WorkOS.
- WorkOS Connect supplies future OAuth/OIDC-provider and M2M capabilities without running our own authorization server ([Connect OAuth](https://workos.com/docs/authkit/connect/oauth)).

Primary blockers: the documented social-provider set does not contain Yandex or a generic OAuth connector, and official docs found for this study document hash import but not outgoing password-hash export. WorkOS is a go only if Yandex can be deferred or WorkOS demonstrates a supported connector, and a contract/API guarantees an acceptable user/identity/credential export.

## Sessions, tokens, and application API rules

For the first-party browser, prefer a BFF/session cookie over exposing bearer tokens. OWASP recommends `Secure`, `HttpOnly`, and `SameSite` cookie protections and warns that web storage is JavaScript-accessible ([OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)). OAuth clients and APIs should follow current OAuth security best practice, including exact redirect matching, PKCE, audience restriction, and sender-aware replay controls where applicable ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)).

Required rules regardless of finalist:

- Browser cookie: `Secure`, `HttpOnly`, explicit `SameSite`, narrow domain/path, bounded idle and absolute lifetime.
- State-changing cookie-authenticated endpoints: CSRF protection plus origin checks; do not rely on `SameSite` alone.
- Direct API/mobile access later: short-lived JWT access tokens with exact `iss` and `aud`; rotating refresh tokens only at a trusted client/BFF.
- Machine access: distinct client/service principal and narrow audience/scope; no email identity and no user Membership inheritance.
- Logout/revocation and Membership revocation are separate. Membership denial should take effect on the next application authorization check, even if the identity session remains valid.
- Do not put application entitlements into long-lived identity tokens. A stale token must not keep paid/member access alive.
- Audit login, recovery, linking, factor changes, client grants and administrator changes without logging OTPs, passwords, session cookies or tokens.

## One-VPS production reality

No self-hosted choice provides high availability while the application, IdP and PostgreSQL share one VPS. Multiple containers on that host improve process isolation, not failure-domain availability.

For v1:

- run one auth service instance (or embedded Better Auth) and one PostgreSQL primary;
- take encrypted, off-host PostgreSQL backups and retain the exact auth configuration, templates, connector secrets, signing/encryption keys and version manifest;
- perform a restore into an isolated environment before launch and at least quarterly;
- monitor login success/error/latency, OTP send and verify rates, provider callback failures, session creation/revocation, DB saturation, and clock skew;
- rate-limit by account, IP and action; add delivery-provider suppression/abuse controls;
- document a degraded mode. Public content can remain available during an identity outage; protected mutations fail closed; existing Membership access may continue only while a locally verifiable unexpired session/token and a current application entitlement are both valid.

Real HA requires at least an independent database failure domain and multiple application/identity instances behind a load balancer—or a managed IdP. That is an architecture trigger, not a container count.

## Bounded PoC and go/no-go

**Timebox: five engineering days, staged around the owner's Logto preference.** Use synthetic users, one App Router shell, one NestJS API, the real target reverse proxy, Mailpit plus a staging email sender, and the same app-owned Membership fixture throughout.

| Time | Logto task | Required evidence |
|---|---|---|
| 0.5 day | Production-like skeleton | Pinned Logto image, persistent PostgreSQL/connector volumes, private Admin endpoint, stable `auth.*` issuer, Next traditional client and Nest API resource |
| 1 day | UX and identity flows | Branded prebuilt UI + minimal CSS; email-code registration/sign-in; resend/lockout/error states; optional-password toggle; Account Center; mobile/accessibility review |
| 0.75 day | Next BFF and Nest protection | Callback/session/logout; no browser tokens; BFF route calls Nest; RSC expiry case; JWT wrong issuer/audience/expiry; current Membership revocation |
| 0.75 day | Yandex and protocol future | Generic OAuth callback/profile mapping; verified/unverified/missing email; safe manual link/unlink; one M2M token; one third-party OIDC client and consent |
| 1 day | Operations and exit | Idle/peak CPU/RSS/disk; cold restart; off-host DB/config/KEK restore; one version upgrade/rollback rehearsal; audit/webhook/cleanup; 100-user synthetic export |
| 0.5 day | Fallback delta or hardening | If any hard gate fails, prove Better Auth email-code + inline form + Nest session seam; otherwise close Logto defects |
| 0.5 day | Decision memo | Go/no-go evidence, accepted losses/risks, capacity cost and ADR proposal |

Logto is **go** only when all of these are demonstrated:

1. The owner approves a redirect to a branded `auth.inside.*` origin and accepts the visible Logto mark in OSS. The v1 design needs no experience fork and no Cloud-only Bring your UI.
2. The chosen VPS has the published 2 vCPU/8 GiB/256 GiB Logto minimum **plus measured headroom** for PostgreSQL, Next.js, NestJS, OS and traffic peaks. Container restart does not lose connectors or data.
3. Email registration/sign-in, fixed 10-minute code expiry, one-time use, resend/rate limit, enumeration-safe errors and delivery telemetry satisfy the product policy. Password can be enabled later without remapping users.
4. Next stores encrypted session state in `HttpOnly`/`Secure` cookies; access and refresh tokens never reach browser JavaScript/logs. RSC token expiry does not cause refresh on every request because protected data goes through a cookie-writing BFF route/action or an accepted external session store.
5. Nest rejects missing/bad signature, wrong issuer, wrong audience and expired JWTs; machine and user principals are distinct. Removing `MembershipAccess` denies the next protected request even while the Logto session remains valid.
6. Yandex maps a stable provider ID, handles absent/unverified email by explicit email verification, and cannot attach to an existing Principal on email alone. Link/unlink and recovery cannot leave an unreachable or takeover-prone account.
7. A restored database plus pinned config, connector volume and `SECRET_VAULT_KEK` preserves the expected identities, grants, signing keys and clients. The upgrade alteration is repeatable and rollback prerequisites are written.
8. The team accepts one OSS Console administrator without Console MFA, a private Admin endpoint, and compensating proxy/change-control audit. Management API changes have an Inside-owned audit trail because Logto does not record them.
9. The synthetic export enumerates portability of profiles, emails, social subjects, password hashes, factors/passkeys, grants/sessions, applications, connectors and keys; every non-portable item has an accepted re-enrollment/cutover plan.
10. The OIDC third-party client and M2M credential prove the architectural reason for selecting Logto. If these capabilities remain purely hypothetical, their operational cost does not justify the IdP.

Logto is **no-go** on any unaccepted item above. Better Auth then becomes the target if it passes the inline email-code, Nest session, Yandex linking and database restore checks. WorkOS is not part of this PoC unless the owner changes the deployment decision to managed identity. At the end, record the choice as an ADR in the application repository; do not stretch the spike into production implementation.

## Triggers that change the recommendation

Keep **Logto as target** when at least one standards/control-plane benefit is committed and the PoC gates pass:

- a second first-party app or native/mobile client in the next two releases;
- third-party OAuth/OIDC clients, consent, multi-app SSO, or `client_credentials` in the next 12 months;
- an organizational requirement for a dedicated identity administration plane, with the OSS single-admin limit accepted;
- the team rejects the maturity risk of Better Auth's Nest integration/provider plugin;
- auth must be deployable/scalable independently from the application.

Choose **Better Auth instead** when any of these is true:

- email/password/code fields must be rendered and submitted inline inside Next.js rather than through an OIDC redirect;
- the VPS cannot meet Logto's published minimum plus application/database headroom;
- a single OSS administrator without Console MFA or the visible Logto mark is unacceptable, and Cloud is not desired;
- the team will not own a separate IdP, persistent connector artifacts, schema alterations, audit cleanup and restore drills;
- external OIDC clients, SSO and M2M remain uncommitted, making Logto control-plane complexity speculative;
- a portable logical credential/factor export is mandatory and the PoC cannot produce an accepted exit plan.

Choose **WorkOS** instead if managed identity is an explicit owner preference, data residency/procurement are accepted, Yandex is deferred/solved, and export is guaranteed. Reconsider Clerk if managed hosting is desired but password-hash export is a harder gate than WorkOS pricing or future `client_credentials`.

Revisit Keycloak, ZITADEL or Ory only if the scope becomes a broader organization-wide IAM/control-plane program, enterprise federation becomes central, or the team accepts the operational/custom-login work. Revisit Supabase Auth if the platform independently adopts the wider Supabase stack and its provider/passkey features leave beta. Do not fall back to Nest/Passport DIY unless the owner knowingly funds a security product, not just a login form.

## Open owner decisions

1. **Primary v1 UX:** email verification code (recommended) or password? Code login removes password recovery UX but makes deliverability, inbox latency and abuse cost part of the critical path.
2. **UX seam:** does the owner approve redirect to a fully branded `auth.inside.*` page, or must credential fields remain inline in Next.js?
3. **Provider horizon:** is Inside acting as OAuth/OIDC provider a credible ≤12-month requirement or only strategic optionality?
4. **Yandex horizon:** required at v1, next release, or uncommitted? This is decisive for managed options.
5. **Operations:** what is the actual VPS capacity, and is the team willing to allocate Logto's published minimum plus app/DB headroom and own keys, email abuse, upgrades and restore drills?
6. **Exit requirement:** must password hashes/passkeys be portable, or is a forced passwordless re-verification/reset acceptable during migration?
7. **Recovery/support:** who may recover, merge, disable or unlink accounts, under what evidence and audit policy?
8. **Operator security/branding:** are one OSS administrator without Console MFA and the visible Logto mark acceptable with a private Admin endpoint, or does that force Cloud/Better Auth?

Until these are answered, the reversible working decision is **Logto OSS provisionally, Better Auth on any failed hard gate**, with application-owned authorization in both cases.
