# inside.mini-app-sign-in.v1

Owner: Telegram Bot Sign-in in `apps/telegram`; consumer: pinned Logto `inside-telegram` connector.
Implementation task: [#461](https://github.com/sachkov-inside/platform/issues/461).
Status: light implementation; real provider/consumer conformance is pending.

`schema.json` is generated from `mini-app-sign-in.contract.ts`. Generate it with
`pnpm --filter @inside/telegram contracts:mini-app:generate`; guardrails checks drift.
`fixtures.json` contains synthetic requests and no real Telegram data.

All Mini App routes require the existing separate sign-in integration bearer credential and return no-store
responses. Platform and the browser never receive the bot token. Mini App is independently off by
default (`TELEGRAM_MINI_APP_ENABLED=false`) and requires bot sign-in configuration.

The provider and server-side connector binding are implemented in the draft. The trusted browser bridge,
Platform BFF initiation and native Logto/browser verification remain pending. No direct public query
parameter carries proof. Until the bridge proves the browser, Mini App transfer fails closed.

1. The planned BFF entry calls the official SDK sign-in. The SDK owns its normal state, PKCE
   verifier/challenge and encrypted cookie. The BFF adds an opaque `inside_mini_app_request` reference
   to that authorization URL. It never puts raw initData or its initial browser secret in the URL.
2. `oidcContextDigest` is SHA-256, encoded as unpadded base64url, of UTF-8 `JSON.stringify`
   `[client_id, redirect_uri, state, code_challenge]`, in this exact order. Values come from the
   SDK-generated URL, not from a public target-user field. `fixtures.json` has an independent vector.
   The request uses `response_type=code` and `code_challenge_method=S256`.
3. The trusted bridge/provider adapter registers the five-minute attempt with
   `POST /integrations/identity/v1/sign-in/mini-app`. It supplies the context digest and a random
   initial browser-secret digest. The bridge must prove the original browser through the official
   BFF session before storing `{requestRef, oidcContextDigest, launchBrowserSecret}` under
   `insideMiniAppBrowserBinding` in that exact native Logto interaction. This bounded operation
   metadata uses existing Logto storage and expiry. Its authenticated write/round-trip adapter is
   pending; a public request reference cannot write or select this proof. #461 permits no separate
   Mini App cookie, JWT or session table. `registered` retains `confirmationCode` for the old attempt model;
   that code is not login proof. The approval envelope goes to `/:requestRef/approve`. Telegram
   verifies initData, the initial browser secret, environment, identity and launch freshness.
4. An approved but unbound launch cannot be consumed. After normal OIDC navigation, Logto reads
   the original interaction's authorization parameters. For the exact `inside-telegram` connector,
   its helper ignores a client-selected social `scope` and derives the digest itself.
   It also requires that private native interaction record, matching request and context exactly.
   State and PKCE challenge are public transcript
   fields; possession of that URL alone cannot authorize transfer or native social side effects.
5. The connector derives its opaque browser secret with HMAC-SHA-256 keyed by the private launch
   secret. The UTF-8 message is `JSON.stringify` of `["inside.mini-app.connector.v1", requestRef,
   oidcContextDigest, nativeInteractionJti]`. The last value comes from the native interaction.
   It calls the authenticated `POST /integrations/identity/v1/sign-in/mini-app/:requestRef/bind` with
   the new digest and private `launchBrowserSecret`. Telegram compares both the original context
   and immutable initial browser digest under a row lock, requires approved proof and TTL, and replaces the initial secret
   digest exactly once. Same-context/same-secret retry returns `bound` with the original expiry.
   Another context or another secret after binding returns `unavailable`.
   A lost bind response can repeat the same native interaction with the same private record and deterministic
   secret. A different native interaction derives another secret and cannot take over the attempt.
6. The connector stores the secret, social state and request in normal Logto connector storage.
   It drops internal `scope` before storing; the initial secret never enters connector storage or a redirect.
   It returns the existing native social callback with `state`, `inside_state` and opaque `code`
   reference. Callback checks these fields and TTL before any provider consume or receipt read.
7. Normal `inside.bot-sign-in.v1` status, consume and account-link use that same request, stable
   subject, link and identity reservation. Consume remains one-time. The same signed launch cannot
   approve another request. Approval retries cannot change the verified identity.

Mini App approval adds no bot prompt or message. It stores only the canonical proof digest and
verified Telegram user ID in the existing attempt journal; raw initData/profile data is discarded.
Disabling Mini App blocks registration, approval, binding and inspection. The Logto connector also
requires its independent `miniAppEnabled` configuration, off by default. Bot attempts remain independent.
Ordinary email login and established BFF sessions keep their existing contracts.

Malformed envelope returns HTTP 400; missing/wrong integration credential returns HTTP 401.
Unknown request, wrong browser secret, wrong bot/signature, missing identity, replay and conflict
return `unavailable` without disclosing another owner. Other outcomes are `disabled`, `expired`,
`approved`, `consumed` and registration's `registered`.

`POST /integrations/identity/v1/sign-in/:requestRef/receipt` accepts the same authenticated
`inside.bot-sign-in.v1` browser-secret envelope as consume. It returns a `verified` result only
for an already consumed attempt, within its TTL and under its original browser binding. It reads
the persisted stable subject and current confirmed link; it neither consumes nor creates a subject.
The connector requests this receipt if consume's response is lost or reports an unusable result.
An approved but unconsumed attempt returns `unavailable` from receipt. Disabled/expired attempts
cannot be recovered. No callback secret or proof is put in a public redirect.

For Inside Telegram only, the fork retains connector storage until the native interaction completes
or expires. A failed HTTP call therefore does not erase the browser binding before a callback retry.
This change remains source/adapter evidence until tested on the isolated pinned Logto runtime.

`node --experimental-vm-modules --test scripts/telegram-connector.test.mjs` checks the actual
connector source with supplied HTTP and Connector Kit boundary doubles, using a fixed clock.
The root `test:tooling` command enables VM modules for this adapter contract. This is light adapter
evidence, not native Logto or PostgreSQL proof. Real replay arbitration, concurrent linking and
full callback recovery remain required before delivery.
