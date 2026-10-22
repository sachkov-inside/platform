# Local stand accounts and product view

Which accounts the stand offers, how to pass the owner's purchase order, and where the owner's product data lives. Start, stop and ownership rules live in the [local stand runbook](local-stand.md).

## Owner order

The catalog is already on sale: the development seed publishes the product and both subscriptions, so
no manual setup is needed before buying. See [Seeded offer catalog](local-acceptance-sale.md#seeded-offer-catalog).

1. Run `pnpm local:stand` and wait for the addresses.
2. Open <http://127.0.0.1:3000>. A fresh browser context immediately uses the local owner,
   including authoring, private drafts and all local Materials. `localhost` redirects to
   `127.0.0.1` before authentication, so the stand has one origin and one account-choice cookie.
3. The local panel shows the current profile. «Сменить» opens `/__local/accounts`; choose owner,
   learner with access, learner without access, or guest. «К владельцу» returns in one action.
   Explicit learner/guest selection survives reload, tabs and stand restarts. A separate clean
   context starts as owner. The application's sign-out selects guest too.
4. For a purchase check choose the learner without access. Confirm the receipt address in
   «Личный кабинет» → «Покупки» → enter the address → «Получить код». The message lands in
   <http://127.0.0.1:8025>; nothing is delivered externally. Close the Telegram connection dialog
   if it appears; a local purchase does not need it.
5. Buy the product and choose «Оплата прошла» on the bank double. The grant and progress belong
   to that learner Account. Bootstrap and account switching never reset purchases or progress;
   an account that bought access keeps it.
6. Return to owner before checking `/authoring/billing`; the owner already has `platform:admin`.

7. Classify the account as a new buyer before subscribing. Open `/authoring/billing`, find «Кто
   этот покупатель», paste the Account id from the same row into «Определить Account», set
   «Ожидаемая редакция» to `0` for an account with no decision yet, pick «Новый покупатель» in
   «Состояние», fill «Источник» and «Основание», then press «Записать решение». Without that
   decision the subscription refuses, and the refusal looks like a broken payment although it is
   a sales rule.
8. Select the buyer again and subscribe on the storefront. When the product is already bought, the larger plan asks to confirm
   the overlap with a checkbox — that is intended.

## Local account boundary and recovery (#1641)

`local:stand` alone includes the local account gateway from
`config/compose/local/learner-setup.compose.yaml`. It owns the published web port; Next runs behind
it. The gateway exchanges real local Logto personal access tokens and wraps the normal Web session.
The API still verifies signatures, issuer, audience, Account and permissions. There is no new API
trust header or production authentication flag. The local owner receives `platform:admin` through
the existing owner bootstrap. The learner with access receives a persistent manual tariff assignment
through Account Rights; both learners lack authoring permission.

On first launch the bootstrap reuses the owner email in `.identity-proof/authoring-owner-pat.json`.
Without an earlier owner it creates `owner@inside-local.test`. The two separate synthetic learners
use `learner@inside-local.test` and `learner-with-access@inside-local.test`. Repeated launch keeps
Account IDs, content, imports, purchases and progress. It adds no publication. The generated
`.identity-proof/local-accounts.json` contains credentials, stays private and is mounted read-only.
If the Logto tenant was explicitly reset, the next normal launch renews its invalid personal tokens.
Never copy this state or the local adapter to production.

The gateway and fixture entrypoint are absent from release images. Bootstrap checks the actual
Compose API's development mode and exact local issuer before writing; the running gateway checks
an authenticated development environment response. Its identity endpoint is pinned to local Logto,
its public address is loopback, and the published Docker port binds only `127.0.0.1`. Requests with
foreign Host/Origin are refused; switching uses same-origin POST and an allowlisted profile, never
an arbitrary Account ID. A signed HttpOnly choice cookie is independent of Logto session expiry;
a malformed choice fails closed to guest. Identity failure answers unavailable rather than owner.
Normal top-level links and browser navigation work from any referring site, including a
`localhost` redirect. A public entry document first establishes the local origin, then loads the
requested page with the existing SameSite=Strict choice cookie. It contains no owner session or
protected response, so a previously selected learner or guest remains selected, including after
an upgrade. Cross-site background requests, embedded documents and
mutations remain refused; navigating from another site does not authorize a profile switch.
Any process with access to this machine can act as these local accounts while the gateway runs.

Use the same Compose files when stopping the stand:

```bash
docker compose -f compose.yaml -f config/compose/local/learner-setup.compose.yaml \
  --profile identity --profile local-accounts down
```

Include `-f config/compose/local/production-web.compose.yaml` for a production-build local stand.
Do not remove volumes. Start again through `pnpm local:stand`, which prepares identity and accounts
before opening the browser gateway. Default Compose without this override keeps its ordinary sign-in.
Production deployment compositions do not include the gateway, local credentials or fixture command;
Host, forwarded headers, query parameters and local flags cannot add its route to a release image.

## Local product view

The stand is where the owner sees the product as production will show it. Its data lives in the
shared `inside-platform_*` volumes, so every branch and worktree sees the same content and accounts:

- `pnpm local:stand` links a worktree's `.identity-proof` to the primary checkout, so the stand keeps
  one set of sign-in keys whatever branch starts it.
- `pnpm local:product [--owner-email EMAIL]` transfers the committed AI Engineering originals from the
  `~/Work/Materials/engineering-content` checkout (override with `--content PATH`) and features that product on Home. It starts the authoring
  gateway for the run when none is running and repeats safely at any time. This local reader view
  approves the publication of every transferred original, as `--publish-all` does; see the publication
  policy below.
- Host checks that migrate, seed or bootstrap owners (`pnpm smoke:fullstack`, the identity proof,
  the Telegram sign-in launcher) use the `inside_checks` database, never the stand's `inside`,
  unless `DATABASE_URL` is exported explicitly. `pnpm smoke:fullstack` drops and recreates that
  database at the start of every run, so products, lessons and buyers created by an earlier run
  never change what the next one sees. The reset, like the Telegram launcher's creation of that
  database, runs in the Compose project named by `COMPOSE_PROJECT_NAME`, or `inside-platform` when
  it is unset. An explicitly exported `DATABASE_URL` is used as it is and never reset: point it at
  a freshly created database before a run whose result you report.

- The seed reads `config/compose/local/seed-stand.env` (`LOCAL_SEED_DEMO=hidden`) unless
  `LOCAL_SEED_VIEW=checks` selects `seed-checks.env`: demonstration Materials stay drafts or
  unpublished in the editor, so Home and search show only transferred originals. They are
  published only in check databases: the disposable Compose smoke project, `smoke:fullstack`, the
  Telegram launcher and the editor review.
- Home lists only originals marked `show_in_feed: true`; an empty feed means no original is marked yet.

Stopping the stand keeps these volumes; [Stop and keep data](local-stand.md#stop-and-keep-data)
names the commands and the volume-pruning hazard.
