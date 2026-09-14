# Subscription activation v1

The separate TELEGRAM_ACTIVATION_INGRESS_SECRET authenticates Telegram's course-source authority. No community-dispatch, membership-evidence or notification credential is interchangeable. All requests use private bot identity, never a user-supplied Account ID or membership statement.

POST /integrations/telegram/v1/subscription-activation/attempts persists attemptId and rule revision. Without an Account it creates no access. The same attempt resumes after linking. POST /evidence accepts source proof: exact audience, sourceRef, identityRef, accountRef, linkRef/linkRevision and ruleId/ruleRevision. checkedAt must not be future or more than five minutes old; validUntil must be future and at most five minutes after checkedAt. Clock and relational constraints are runtime assertions, not only JSON Schema validation.

Course identity is SHA-256 of UTF-8 JSON array ["course", sourceRef, identityRef]. Different links/rules for this source do not produce new rights. Only the first committed activation starts the unlimited period. Enrollment, grant, source relation, access change, attempt result and evidence receipt commit atomically. Revoke is an independent owner decision: retries never undo it. A lost answer is retried using exactly the original evidenceRef and payload. An expired proof requires fresh source verification.

POST /own-access requires the exact current private binding and returns independent grounds, Enrollment snapshots and admission state. A tariff never clears moderation. Responses are private/no-store. Examples contain synthetic identifiers; no provider is enabled by this bundle. Telegram #64 implements the consumer and real source verification.
