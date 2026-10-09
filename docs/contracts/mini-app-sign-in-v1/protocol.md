# inside.mini-app-sign-in.v1

Owner: Telegram Bot Sign-in in `apps/telegram`; consumer: pinned Logto `inside-telegram` connector.
Implementation task: [#461](https://github.com/sachkov-inside/platform/issues/461).
Status: light implementation; real provider/consumer conformance is pending.

`schema.json` is generated from `mini-app-sign-in.contract.ts`. Generate it with
`pnpm --filter @inside/telegram contracts:mini-app:generate`; guardrails checks drift.
`fixtures.json` contains synthetic requests and no real Telegram data.

Both routes require the existing separate sign-in integration bearer credential and return no-store
responses. Platform and the browser never receive the bot token. Mini App is independently off by
default (`TELEGRAM_MINI_APP_ENABLED=false`) and requires bot sign-in configuration.

1. Logto creates the normal interaction and retains its random browser secret, state and request.
2. `POST /integrations/identity/v1/sign-in/mini-app` registers the five-minute attempt with the
   registration envelope. `registered` has `confirmationCode` and `expiresAt`; the code is retained
   for compatibility with the existing attempt model and is not login proof.
3. Logto receives raw `initData` from the bound browser and posts the approval envelope to
   `/integrations/identity/v1/sign-in/mini-app/:requestRef/approve`. Telegram checks the credential,
   bound browser secret, attempt source, expiry, signed identity and launch freshness.
4. The same proof cannot approve a different request. Retrying approval on the same request with
   the same browser secret/proof converges on `approved` or `consumed`. The identity cannot change.
5. Normal `inside.bot-sign-in.v1` status, consume and account-link then use the same request.
   They retain stable subject, existing link and identity reservations. Consume remains one-time.

Mini App approval adds no bot prompt or message. It stores only the canonical proof digest and
verified Telegram user ID in the existing attempt journal; raw initData/profile data is discarded.
Disabling Mini App blocks its approval and inspection. Bot attempts remain independent.
Ordinary email login and established BFF sessions keep their existing contracts.

Malformed envelope returns HTTP 400; missing/wrong integration credential returns HTTP 401.
Unknown request, wrong browser secret, wrong bot/signature, missing identity, replay and conflict
return `unavailable` without disclosing another owner. Other outcomes are `disabled`, `expired`,
`approved`, `consumed` and registration's `registered`.

Unknown consume outcome still needs connector-side reconciliation or a fresh verified launch;
this draft does not claim that recovery is complete. Real PostgreSQL replay arbitration,
concurrent bot/Mini App linking and full Logto callback are required before delivery.
