# Community entitlements: Platform producer

Platform side of `inside.community-entitlement.v1` and `inside.billing-dispatch.v1`, delivered by
[#415](https://github.com/sachkov-inside/platform/issues/415). The normative protocol is the
repository-local bundle in [`docs/contracts/billing-v1/`](../contracts/billing-v1/protocol.md);
this page describes only what the application does. The Telegram consumer is
[inside-telegram #55](https://github.com/sachkov-inside/inside-telegram/issues/55).

## Surface

| Direction | Endpoint | Contract |
|---|---|---|
| Platform → Telegram | `TELEGRAM_COMMUNITY_ENTITLEMENT_ENDPOINT` | `inside.community-entitlement.v1` |
| Telegram → Platform | `POST /internal/billing-dispatch/authorize` | `inside.billing-dispatch.v1` |
| Owner → Platform | `GET /community-entitlements/{accountId}` | Platform REST, `platform:admin` |

The dispatch endpoint fails closed: without `TELEGRAM_COMMUNITY_DISPATCH_SECRET` every request is
`401`. A body over 16 KiB, another contract version and a schema-invalid payload produce no effect.
Without a parseable `operationId` the answer invents no correlation. Notification dispatch keeps its
own facet at `/internal/notifications/dispatch/authorize`; a `notice.send` effect or the
notification contract version sent here is denied `effect_conflict`.

## Desired state

`CommunityEntitlements.project` reads two public facets and writes neither. Access comes from
`assembleAccessGrants.resolveCapabilities`, which unions every live paid, manual and legacy reason,
including a live `guide:<id>` right, which opens the shared chat on its own term; the verified link
comes from `TelegramAccountLinks.readBinding`. A missing community capability is `denied`, an
unbounded one is `lifetime`, a bounded one is `finite` with its exact end. The tier name, the price,
the presence of a payment and Telegram membership itself are never the rule.

One row per Account holds that desired state with a monotone `entitlementRevision`. The revision
also increases when the verified link moves, not only when access changes. A stale read never moves
a projection backwards: a lower access or link revision is ignored and the next pass corrects it.

An unlink or relink produces two separate commands to two separate recipients: a `cleanup` denial
addressed to the historical binding, and, when a new link exists, an `apply` command addressed to
it. The recipient is the opaque account reference, so a new link creates a new recipient even when
the Telegram identity behind it is unchanged. A denial is only ever sent to a recipient that was
previously told to admit.

## Delivery

`telegram_membership.community_operations` is the durable outbox. Each row stores the exact wire
command, its SHA-256 canonical fingerprint, the delivery state and the last provider result.
A lost answer is retried with the original `operationId` and the identical payload, so a repeat can
never become a second command. Backoff is 1, 5 and 30 seconds. Only a lost answer is retried: a
decided refusal becomes `rejected` and is operator work, never a new operation identifier. An
undelivered command for a recipient is superseded locally as soon as a newer one is issued for it.

Every answer is correlated against the command it replies to, not just its identifier: the same
operation, recipient, entitlement revision and access. A result carrying a foreign binding, another
revision or another access is an unknown outcome, never a fact recorded about the Account.

Telegram sends no callback. `entitlement.status` polling on the reconciliation cadence is how an
accepted intent becomes an observed application, and how a member who left is noticed without a new
entitlement revision. A queue acknowledgement is never presented as membership: desired, accepted
and applied stay separate fields and are visible through the owner endpoint. Our own lifecycle
never overwrites what the provider reported: a command displaced by a newer one for the same
recipient is marked superseded in the delivery state and keeps its last provider answer.

The background pass runs in `billing-worker` once a minute and covers three sources without any
user request: the ordered access-change cursor, a reached expiry boundary, and a changed verified
link. Projection and delivery happen in the same pass, so a change found by a pass is sent by that
pass. The cursor only advances over a fully projected window, and only a failure inside its own
window holds it back: an unrelated boundary or link Account cannot stall the audit trail. Work
still unfinished after five minutes is reported as `operator_attention`.

## Dispatch authorization

Before each external effect Telegram asks for a fresh permit. Platform recomputes the current
combined access and the current verified binding instead of trusting the queued command:

- an unknown dispatch denies `not_found`;
- a fingerprint that does not match the stored command denies `payload_conflict`;
- admission requires the exact current binding, otherwise `binding_conflict`; the recipient is
  checked before the revision, so a command whose verified link has moved is named a binding
  conflict whether or not a newer command was issued yet;
- a newer command for the same recipient denies `superseded`;
- a lapsed finite right denies `expired`, a withdrawn one `superseded`;
- removal is allowed only while the combined access denies, so an expired reason cannot remove a
  member who already holds another live one;
- removing a historical identity after an unlink is allowed only through this Account's own
  recorded binding and only when that identity was not transferred; a disputed one goes to the
  operator as `binding_conflict`.

An unavailable answer is a transient failure, not a decision, and is never stored: the same
authorization identifier can still reach a real answer on a later attempt.

An allowed permit lives at most five seconds and never past the right's own end. It is a freshness
statement, not a reservation: the effect ledger belongs to Telegram, and repeating the same
authorization `operationId` returns the original answer including its original deadline. The same
identifier with a different payload is `operation_conflict`.

## Configuration

Three settings are absent by default and are configured together; each direction has its own
credential and no other caller inherits community authority. The two community secrets must differ
from each other and from every other configured Telegram secret, and startup fails otherwise. The
gate covers only these two settings, so an existing deployment keeps starting as it did.

```bash
TELEGRAM_COMMUNITY_ENTITLEMENT_ENDPOINT=https://telegram.example.com/integrations/platform/v1/community-entitlements
TELEGRAM_COMMUNITY_ENTITLEMENT_SECRET=<private-provider-integration-secret>
TELEGRAM_COMMUNITY_DISPATCH_SECRET=<private-dispatch-callback-secret>
```

Without them the background pass is not registered and nothing is queued or sent. Real chat, real
bot rights, real admission and Tribute coordination remain separate owner gates; synthetic tests are
not credentialed proof.

## Boundaries

A community failure never changes a confirmed payment and never touches material access: an Account
without a link, with a blocked bot or with an unavailable provider keeps everything its paid or
manual reason grants. The worker never turns a Telegram observation back into a paid or manual
grant, and this producer never writes access.
