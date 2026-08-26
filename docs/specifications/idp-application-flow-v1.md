# Logto application flow v1

Статус: canonical provider/application contract после local proof PR #108 и упрощения Account
foundation в [#124](https://github.com/sachkov-inside/platform/issues/124), 2026-08-26.

## Authority and decision

Logto OSS is the only Identity Provider target. Better Auth remains rejected. Logto authenticates;
Platform maps the verified identity to an Account and authorizes business operations. The complete
local Account contract lives in
[`identity-principals-session-v1.md`](identity-principals-session-v1.md).

The chosen topology keeps:

- separate Logto deployable, database and migration authority;
- owner-maintained minimal Logto Experience UI fork for Russian/light Platform branding;
- external email connector;
- official `@logto/next` App Router BFF SDK;
- authorization code, high-entropy state and S256 PKCE;
- short-lived JWT for the exact Platform API resource;
- hard duplicate verified-email conflict.

Platform never reads Logto database tables, runs migrations against them or imports provider
runtime into application modules.

## Protocol facts

- OIDC stable user identity is exact `iss + sub`; email is mutable
  ([OIDC Core claim stability](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability)).
- OAuth Security BCP requires PKCE for authorization-code clients; Platform uses S256
  ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1)).
- JWT verification allowlists ES384 and checks signature, exact issuer, exact audience, expiry,
  issued-at, bounded lifetime and non-empty subject
  ([JWT BCP](https://www.rfc-editor.org/rfc/rfc8725.html#section-3.1)).
- Resource indicator binds the token to Platform API
  ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)).
- Official Logto Nest guidance uses `jose`, JWKS, issuer and audience validation
  ([Logto Nest guide](https://docs.logto.io/api-protection/nodejs/nestjs)).

The pinned Logto/JS client uses state and S256 PKCE and does not send nonce for this pure code flow.
If a future pinned SDK starts sending nonce, matching validation becomes mandatory.

## Browser and BFF boundary

1. Same-origin POST asks `@logto/next` to begin sign-in.
2. Logto Experience collects email and verification code. Email/code never pass through Platform.
3. Official SDK validates callback state/PKCE and exchanges code server-side.
4. SDK stores provider context in encrypted `HttpOnly`, `SameSite=Lax`, production `Secure` cookie.
5. Browser JavaScript never receives access, refresh or ID token.
6. BFF requests a JWT for the exact Platform audience and sends it server-to-server to Nest.

The pinned upstream client currently omits OAuth `resource` from the authorization-code exchange.
One narrow `AudienceBoundLogtoClient` adapter adds it only to that request. It is contract-tested
and should be deleted when upstream does the same.

Platform does not add `inside_session`, `inside_signin`, sessionRef, custom callback idempotency or
reauthentication cookies. Official Logto SDK context is the only BFF session.

## Token claims

The owner-controlled Logto custom access-token script exposes one private claim for direct
authorization-code issuance:

- `inside_verified_email`: primary email only when the current interaction verified the same email.

Nest requires this claim only for `POST /accounts`, where an interactive callback may establish an
Account or update its email fingerprint. `GET /accounts/current` ignores email and resolves only
exact issuer + subject. Missing/malformed email fails Account establishment closed.

`inside_interactive_at` was removed with custom re-authentication. Provider roles, scopes, groups,
permissions and profile fields are discarded before the Account module.

## Lifetime and logout

- Platform API access JWT maximum lifetime: five minutes.
- Provider/BFF session lifetime is owned by pinned Logto configuration and SDK; Platform does not
  mirror it in a database row.
- Refresh remains server-side and single-flight in the BFF.
- Official Logto sign-out clears local provider context, attempts refresh revocation and redirects
  to end-session. If provider cleanup fails, Platform clears the same official local cookie and
  reports incomplete global logout.
- A bearer JWT issued before logout can remain valid until `exp`; owner accepts this residual window
  up to five minutes.

There is currently no local Account disable switch. Account administration and any stronger online
revocation check require a separate consumer-driven design.

## Email abuse controls

Logto 1.41 applies a mandatory per-recipient sending limit of ten messages per ten minutes and
returns `request.message_rate_limited`
([send rate limit](https://docs.logto.io/security/send-rate-limit)). Verification-code expiry and
identifier lockout remain provider responsibilities.

Platform does not add a Next-side email limiter because Next does not receive the email address.
CAPTCHA is deferred until a separate regional proof. Logto supports Google reCAPTCHA Enterprise and
Cloudflare Turnstile, but external scripts must be verified from Russian networks before enabling
them ([CAPTCHA](https://docs.logto.io/security/captcha),
[Turnstile](https://docs.logto.io/security/captcha/turnstile)).

## Required proof gates

### Frozen environment

- Pin Logto image/version/digest, matching CLI, SDK, `jose`, Experience upstream revision,
  PostgreSQL and test email service.
- Freeze immutable issuer, callback/post-logout URLs and Platform API resource.
- Build the Experience fork and preserve a small inventoried diff/rebase path.

### Callback and browser boundary

- Redirect contains code flow, exact callback, state, S256 PKCE and Platform resource.
- Callback replay, missing/replaced state, wrong verifier/path and malicious query fail before an
  Account is authenticated.
- Cookie remains HttpOnly/Secure/SameSite and no token/PII appears in browser graph or logs.
- Interleaved browser transactions do not swap SDK state/verifier.

### JWT and Account mapping

- Valid human token establishes one Account; concurrent calls converge on it.
- Same issuer/subject returns the same Account after email change.
- Different subject with the same verified email returns `identity_conflict` without merge.
- Signature, algorithm, issuer, audience, expiry/not-before, lifetime and subject negative corpus
  fails closed.
- M2M `client_id === sub` fails both human Account paths.
- Provider roles/scopes never alter `materials:manage` or Membership.

### Outage and lifecycle

- Provider/email failure before proof produces no Account mutation.
- Warm JWKS can validate an unexpired token while issuer is unavailable; cold/unknown key fails
  closed.
- Refresh failure clears local SDK context without anonymous downgrade of a protected request.
- Logto initialization, representative upgrade, restart and disposable restore remain repeatable.

## Production gates still open

Local proof does not approve production DNS/TLS, email credentials/deliverability, SPF/DKIM/DMARC,
secret/JWK custody, backup/PITR, capacity, monitoring, audit retention, incident response, image
supply chain or release rollout. Those are release/infrastructure decisions, not reasons to grow
the Account application interface.
