# Community entitlement v2

Platform produces only v2 effects when TELEGRAM_COMMUNITY_CONTRACT_VERSION explicitly equals inside.community-entitlement.v2. No downgrade. Historical v1 receipts remain readable, but pending v1 effects are superseded.

admissionRestriction is mandatory: none, moderation, external_unknown. A content grant never clears either restriction. Checking is shown until a result matches the current binding. Delivery status alone is not moderation evidence.

Dispatch envelope stays inside.billing-dispatch.v1. The target version and SHA-256 of the complete canonical set command must match the stored operation. Keys sort lexically, array order is preserved. Each effect requires a fresh permit, valid for at most five seconds. Retry uses the same operation identity and digest.

This portable bundle is consumed by Platform provider doubles and is the consumer contract for Telegram #64. It does not enable a real integration. The immutable billing-v1 bundle remains unchanged.

#823 adds optional `groupUrl` to `entitlement.result`. It is an HTTPS `t.me/c/<channel>/<message>`
link for an existing member, not an invitation. The provider derives the supergroup ID from
its canonical Bot API chat ID and targets message 1 to open the member's chat. The field is absent
for non-members, restrictions, denied access and non-supergroup chats. An older v2 result without
this field remains valid; v1 never includes it. Platform shows “Открыть группу” only after matching
the result to current access and binding. Deploy Platform first, then Telegram.

The shared runtime codec lives in `@inside/contracts/community-result`. Official Telegram
[message-link syntax](https://core.telegram.org/api/links#message-links) requires the message ID;
the Android client opens the chat with that ID. A real device check remains release evidence,
not something portable conformance fixtures prove.

Platform hides `groupUrl` after a failed provider poll or more than two reconciliation intervals
(120 seconds) without a successful result or a current provider `updatedAt`. A successful HTTP status replay
cannot refresh the age of Telegram’s stored observation. The previous member status remains
as the #822 fallback.
