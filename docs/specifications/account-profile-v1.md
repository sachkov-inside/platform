# Account profile and first email attachment

The owner's 2026-10-20 assignment restores editable display name in the existing `/account`
cabinet, exposes current Telegram contact data and sign-in email, and permits a Telegram-only
Account to attach its first email through a verification code.

## Profile

The saved Member Profile `displayName` takes precedence over Telegram contact data. Before a name
is saved, the cabinet shows the current Telegram display name, or «Участник» when unavailable.
The editor starts empty for a missing profile; the Telegram name is a suggestion, not a persisted
profile. Names remain non-unique, 2–80 Unicode code points. Saving a name preserves existing bio
and avatar data. The cabinet does not render or accept edits to «О себе».

Telegram name and optional username are read from the current confirmed Account link. Missing
username, no link and provider failure remain distinct states. No raw provider/principal identifiers
are returned by the account presentation endpoint. A username is presentation, never ownership proof.

## Sign-in email

The profile email is Logto's current primary email, read with a user-scoped opaque OIDC token.
A new address is limited to 128 characters, matching the pinned provider field.
A missing `email` scope returns an authentication failure rather than an apparently missing address.
It is separate from Billing Contact and Order Email. A confirmed Billing Contact alone never
becomes a sign-in method. Existing email identities are read-only in this scope.

A first-party authenticated Telegram-only user with no email, phone or password can request a
`BindNewIdentifier` code. The code record belongs to that exact Logto user, expires after ten
minutes, and uses Logto's existing recipient send cap, Sentinel attempt protection and blocklist.
The browser and Platform API never receive identity-provider access tokens; the same-origin BFF
forwards the entered code directly to Logto. Cross-origin mutation requests are rejected.

Confirmation verifies record ownership, type, template and code before attaching the address.
The existing provider user is updated with compare-and-set while its email remains empty.
Competing attachment of another address fails. Identifier uniqueness prevents transfer of another
user's address. No Account, permission, purchase, grant or Telegram link is created or merged.
The next email-code sign-in resolves the same `iss + sub` and therefore the same Platform Account;
the existing duplicate-fingerprint conflict policy still fails closed, including stale historical
fingerprints requiring operator recovery. This flow does not implement that recovery.

Proof is persisted before the credential update, so a retry can finish after a lost response.
A retry of a successful attachment within the record lifetime succeeds without replacement.
A new request after success cannot change the email. Neither route can be used to change an
existing password/phone/email credential. Expired records and another user's records are rejected.

## Runtime preparation and verification

Ship the `inside.8` Logto fork alongside Web. In Logto Account Center, enable the API and set the
email field to `Edit`; keep other field permissions as configured. The local bootstrap configures
this and the SMTP `BindNewIdentifier` template. Production must configure that template and field
permission before exposing the new flow. Existing browser sessions need a new sign-in to consent
to the added `email` scope if their grant lacks it.

Primary email changes become available to Platform receipt metadata on the next resource-token
refresh. They do not overwrite a separately verified Billing Contact or opt the user into messages.

Build the fork with the pinned Dockerfile. `scripts/account-email-proof.py --image <built-image>`
starts its own disposable Logto, PostgreSQL and Mailpit without touching the shared stand. It checks
record ownership, wrong/expired codes, occupied addresses, same provider subject, retry and competing
attachments, and removes its own containers/network on completion. Browser evidence and name edits
use the production modules and their Storybook states.
