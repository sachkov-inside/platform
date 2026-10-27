# Telegram contact v1 and v2

Platform reads the Telegram name and username of an Account's confirmed link from Telegram.
The projection supports authors; it never selects a message recipient. Every operation is a
`POST` with `authorization: Bearer <identity-linking secret>` (Telegram
`PLATFORM_INTEGRATION_SECRET`, Platform `TELEGRAM_LINKING_SECRET`). Telegram compares the bearer
in constant time before it parses the body: a missing or wrong secret is `401`; a body outside
the schema, including an unknown `contractVersion`, is `400`.

## v1 read

`@inside/contracts/telegram-contact`, `POST /integrations/platform/v1/telegram-contacts`,
`inside.telegram-contact.v1`. Up to 100 exact `accountRef`/`telegramIdentityRef` pairs; the
answer keeps their order. Telegram reads each current link's profile live (`getChat`, at most four
requests at a time, one shared 3.5 s budget), then reads the links again: a pair whose link
changed during the read is `not_found`. `unavailable` means the link is current but Telegram did
not answer; name and username are then `null`.

The v1 wire format is unchanged, but since `inside.telegram-contact.v2` the read is no longer
side-effect free: Telegram stores each `available` profile of a current link for search (see
below). This write is best-effort. If it fails, Telegram still answers the read and writes one
diagnostic line with a technical failure code only, without names, usernames or references.

## v2

`@inside/contracts/telegram-contact-v2`, version `inside.telegram-contact.v2`. The corpus is
[`telegram-contact-v2.fixtures.json`](telegram-contact-v2.fixtures.json): valid and invalid
requests and responses of both operations.

### Read with the `/stop` state

`POST /integrations/platform/v2/telegram-contacts/read` takes the v1 request under the v2 version
and answers with the v1 projection plus `marketing`:

- `enabled`: the person's communications record has no `/stop`;
- `stopped`: the person sent `/stop` and has not sent `/resume`;
- `unknown`: no communications record, or the pair is not a current link.

`not_found` always carries `marketing: "unknown"`, and only `available` carries a name. Telegram
reads the `/stop` state before it re-reads the links, so the re-check covers it too.

### Search

`POST /integrations/platform/v2/telegram-contacts/search` with
`{contractVersion, query, limit}`. `normalizeTelegramContactSearchQuery` trims `query` and drops
one leading `@`; the result must be 1 to 64 characters without control characters. `limit` is an
integer from 1 to 50. Platform sends the normalized query.

The answer is `{contractVersion, matches[], truncated}`; each match is
`{accountRef, telegramIdentityRef, displayName, username}` with `null` for a missing part.
`truncated` means more than `limit` profiles matched; there is no cursor. Matches are ordered by
their stored search text, then by `telegramIdentityRef`.

Telegram searches only the profiles it stores for current links of its bot
(`platform_link_profiles`). A profile is written when a linked user's private update arrives
(`/start`, the bot commands, access buttons, blocking or unblocking the bot) and when a read returns
`available` for a current link (v1 or v2). An observation older than the stored one is ignored. A user
without a current link is never stored. A link transfer deletes the profile in the same
transaction; a profile row also names the link confirmation it was observed under, and the
search joins it with the current `platform_links` row in one statement, so a profile of an earlier
confirmation never matches.

Matching is a case-insensitive substring over the name and, separately, the username. Both sides
are compared after Unicode NFKC normalization, lower-casing and `ё` → `е`, computed by the
application rather than the database collation. `%`, `_` and `\` in the query are literal
characters. The search scans the bot's stored profiles without an index; the page is bounded by
`limit`.

Platform accepts a match only when its `accountRef` and `telegramIdentityRef` are the current
confirmed link of exactly one Account; a transferred, unlinked or ambiguous identity yields
nothing. Neither side writes the query to logs. Platform waits up to 5 s for a read and 3 s for a search.

## Mixed releases

Telegram answers `404` on v2 paths until it runs a release with v2, and the production Caddy
allowlist of that release admits exactly the two v2 paths. Platform treats `404` as
`not_supported`: the read falls back to v1 with `marketing: "unknown"`, and search reports that
name search is unavailable rather than an empty result. Release Platform first, then Telegram;
a newer Telegram with an older Platform only exposes paths nobody calls. v1 is unchanged.
