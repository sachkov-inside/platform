# Public material announcements v1

[`material-announcements.ts`](material-announcements.ts) owns the executable runtime schema.
`POST /integrations/telegram/v1/communications/materials` uses the existing Platform
communications authorization service bearer. It accepts neither an actor nor copy, URLs or
recipients. Its response is private and uncached. No v1 notification broker bundle changes.

A list request contains `contractVersion: "inside.material-announcements.v1"` and optional UUID
`after`. A check request substitutes `announcementRef`; both selectors together are invalid.
The response contains up to 50 `items` and `nextCursor`. Follow continuation even after a filtered
empty page. Exhaustion and unavailability are distinct; a failed request never advances the cursor.
Only unexpired first-publication occurrences whose initial Telegram choice was enabled qualify.
Materials rechecks the current publication, free access and author choice. The feed contains all
published free Materials under ADR 0035; the legacy `showInFeed` value cannot suppress an announcement.
The response exposes public title, summary and canonical reader URL, never a material body.

Telegram fixes a contact snapshot when it first accepts an occurrence. It includes reachable
contacts who started this bot no later than publication and have not disabled messages through
`/stop`. Linking an Account is unnecessary. The bot stores a unique receipt per bot, occurrence
and rollout audience. A restart or replay cannot allocate another broadcast for that audience.
Test and all-contact audiences have separate receipts. A test may therefore be followed by the
same announcement to everyone, including the test recipient.

Before the provider call Telegram obtains a fresh source answer after the committed local claim.
Withdrawal, expiry or changed title/summary/URL cancels the remaining old promise. An unavailable
source defers an unsent claim; it does not create a provider attempt. Current contactability,
preference, broadcast state, service-reply priority and shared rate limits are checked immediately
before transport under the existing bounded admission procedure. A source change after the final
read can race with an already admitted send; services do not share a transaction and cannot recall
an accepted provider call. Unknown transport results remain unknown and are never retried automatically.

The message uses plain author text, a bold title, description, reader URL and an Open material
button. The explicit Telegram link-preview URL selects the reader page's existing social card
and requests large media above the text. Telegram controls whether its scraper produces a card;
a successful send alone cannot prove the cover rendered. The one-recipient live check owns that
acceptance. No separate photo or second fallback message is sent automatically.
