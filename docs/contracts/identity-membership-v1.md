# Inside Identity and Membership contract v1

Статус: cross-repository contract для
[Workspace Specification #65](https://github.com/sachkov-inside/workspace/issues/65).

Этот документ задаёт общую authority boundary, wire envelope и conformance corpus между Platform
и отдельной Telegram application. Он не задаёт application schema, HTTP framework, database tables,
deployment или secret distribution. Каждый repository хранит собственную implementation и
проверяет её против versioned snapshot этого контракта без runtime import соседнего checkout.

## Authority matrix

| Authority | Доказывает или решает | Не даёт |
|---|---|---|
| Email Identity Provider | Контроль External identity для Platform sign-in | Membership, Platform permission или content access |
| Platform | Account, permissions, Member Profile, Membership Entitlement и каждый ContentAccess decision | Telegram identity proof или raw chat status |
| Telegram application | Контроль одной Telegram identity, linking invariants, member-status events и bounded reconciliation evidence | Platform authentication, entitlement, role или final content access |
| Канонический закрытый Telegram chat | Membership Signal через фактическое присутствие linked identity | Platform identity или permanent entitlement |
| Tribute/payment provider | Может менять roster через отдельный operational lifecycle | Identity, evidence или entitlement напрямую |

Member Profile является member-visible presentation и не участвует ни в одной authority chain.
Email, Platform/Telegram internal identifiers, linking/evidence/security history и provider claims
не входят в profile projection. Anonymous visitor, non-member и crawler не получают этот profile.

## Contract identity and evolution

Contract identifier v1 — `inside.membership-evidence.v1`. Consumer принимает только явно
поддерживаемый major version; unknown/missing major version fails closed как
`unsupported_contract`. V1 schema закрыта для неизвестных fields: добавление field, изменение
meaning/required field или reason code требует нового major contract и одновременного bounded
migration plan в обоих owning repositories.

Workspace хранит normative contract и scenarios. Platform и Telegram repositories vendor-ят
versioned snapshot/schema/fixtures в свою test authority; они не читают Workspace во время build,
test или runtime.

Normative machine-readable artifacts:

- [`identity-membership-v1.schema.json`](identity-membership-v1.schema.json) — JSON Schema envelope;
- [`identity-membership-v1.fixtures.json`](identity-membership-v1.fixtures.json) — deterministic
  named consumer/provider corpus. Поле `expected` задаёт contract outcome, а fixture `clock` —
  время consumer validation.

## Normalized Membership Evidence envelope

Envelope переносит normalized application facts, а не provider model:

| Field | Contract |
|---|---|
| `contractVersion` | Ровно `inside.membership-evidence.v1` для этого major |
| `principalRef` | Legacy v1 wire name: opaque Platform-issued integration reference bound to one Account; не email и не raw Account ID |
| `decision` | `member`, `not_member`, `identity_not_linked`, `identity_conflict` или `unavailable` |
| `reasonCode` | Stable reason из таблицы ниже, согласованный с `decision` |
| `checkedAt` | UTC instant authoritative observation; отсутствует, если observation не состоялось |
| `validUntil` | UTC instant finite evidence validity; обязателен для `member`/`not_member` |
| `telegramIdentityRef` | Opaque Telegram-owned reference; обязателен только для linked identity |
| `evidenceRef` | Opaque audit/correlation reference; обязателен для состоявшегося observation |
| `evidenceVersion` | Monotonic version для одной linked identity; older/replayed version не заменяет newer evidence |

Positive `member` evidence удовлетворяет `validUntil > checkedAt` и
`validUntil <= checkedAt + 5 minutes`. `not_member` прекращает новые protected operations сразу;
его finite validity не превращает deny в permanent member flag. `identity_not_linked`,
`identity_conflict` и `unavailable` не создают Membership Entitlement. Expired, malformed,
cross-Account или unsupported evidence fails closed.

Envelope никогда не содержит email, raw Platform Account ID, Telegram user ID/username,
`ChatMember`, `/start` bearer token, bot token, payment/subscription data или provider exception.

## Evidence production and request-path isolation

Telegram application производит один и тот же normalized envelope из трёх источников:

1. link-time `getChatMember` observation для конкретной verified Telegram identity;
2. Telegram member-status update о join, leave, removal или rejoin;
3. background `getChatMember` reconciliation для known linked identities, срок evidence которых
   подходит к концу.

Bot обязан быть administrator канонического chat и явно подписаться на member-status updates.
Provider durably сохраняет update до успешного acknowledgement, deduplicate-ит повторную доставку и
monotonic version не позволяет позднему старому update заменить новое evidence. Member-status event
сразу после provider acceptance создаёт новое evidence; доступ меняется только после того, как
Platform принимает его более новую версию в локальную projection. Пока доставка не завершилась,
five-minute validity bound ограничивает stale positive state. Reconciliation восстанавливает
состояние после пропущенного update, долгого outage или ручного изменения состава chat.

Bot API не используется для перечисления всего roster. Reconciliation проверяет конкретные known
linked identities из provider-owned state. Если link-time или due reconciliation не может получить
authoritative observation, provider возвращает `unavailable`; он не продлевает старый positive
result.

Platform принимает evidence асинхронно, строит собственную bounded PostgreSQL projection и отвечает
на Library/Material requests только из неё. User-facing request не вызывает Telegram и не ждёт
reconciliation. Positive projection после `validUntil` fails closed до нового accepted evidence;
free content от Telegram availability не зависит.

## Stable decision and reason codes

| Decision | Allowed `reasonCode` | Meaning |
|---|---|---|
| `member` | `chat_member` | Linked identity сейчас присутствует в каноническом chat |
| `not_member` | `chat_not_member` | Authoritative observation подтверждает отсутствие/removal |
| `identity_not_linked` | `identity_not_linked` | Account ещё не имеет verified active Telegram link |
| `identity_conflict` | `identity_conflict` | Verified Telegram identity historically/actively связана иначе; silent transfer запрещён |
| `unavailable` | `provider_unavailable` | Authoritative observation сейчас нельзя получить |

Consumer-local validation failures используют `unsupported_contract`, `invalid_evidence`,
`principal_mismatch`, `expired_evidence` или `replayed_evidence` и не принимаются как provider
decision. `principalRef` и `principal_mismatch` остаются стабильными legacy wire labels v1; в
текущей доменной модели они обозначают Account binding и cross-Account mismatch. Platform маппит
accepted/failed evidence в собственные ContentAccess reason codes; IdP или Telegram codes не
становятся permissions.

## Linking and recovery invariants

- Link начинается только из recently authenticated Account flow. Platform создаёт
  high-entropy short-lived single-use base64url bearer token и deep link, регистрируя только его
  digest, expiry и opaque `principalRef` через authenticated Telegram application interface.
- Telegram application принимает `/start <token>` только из private chat от provider-verified
  non-bot sender. Этот receipt создаёт pending candidate, но не завершает PlatformLink и не даёт
  Membership или content access.
- Link завершается отдельным authenticated Platform confirmation, связанным с исходным Account,
  `principalRef` и pending transaction. Email или Telegram ID от caller не принимается
  как proof; Telegram OIDC не участвует.
- Обычный `/start` без link token создаёт или реактивирует независимый `BotContact`; invalid link
  token не отменяет этот contact outcome и не раскрывает существование Account.
- Durable Telegram identity определяется verified provider identity, а не username/display name,
  picture, phone или похожий email.
- Одна Telegram identity исторически принадлежит одному Account; unlink сохраняет tombstone и не
  освобождает identity для silent transfer.
- Same Account + same identity link идемпотентен. Conflict никогда не делает auto-merge.
- Exceptional transfer требует отдельного audited owner recovery; его operational procedure не
  определяется v1 wire contract.
- Membership removal не удаляет link/profile/history. Rejoin может дать newer positive evidence
  без нового Platform account или Telegram relink.

## Normative conformance corpus

Оба owning repositories реализуют эти scenarios одним и тем же именованным fixture corpus. Exact
transport setup и application assertions принадлежат repository, но input facts и expected
contract outcome не меняются.

| Fixture | Input fact | Expected contract outcome |
|---|---|---|
| `linked-member-fresh` | Linked identity, authoritative member observation | `member/chat_member`, finite evidence no longer than five minutes |
| `linked-non-member` | Linked identity, authoritative left/kicked/non-member observation | `not_member/chat_not_member`, immediate deny for new operations |
| `member-removed` | Newer negative follows positive evidence | Once observed, negative supersedes still-unexpired older positive evidence |
| `member-rejoined` | Newer positive follows confirmed removal | Access can return without relink; version increases |
| `identity-not-linked` | Account has no verified Telegram link | `identity_not_linked/identity_not_linked`; no entitlement |
| `identity-conflict` | Telegram identity is bound to another Account | `identity_conflict/identity_conflict`; no merge/transfer |
| `provider-unavailable` | No authoritative observation can be obtained | `unavailable/provider_unavailable`; stale/absent evidence fails closed |
| `positive-expired` | `validUntil` is not in the future | Consumer rejects as `expired_evidence` |
| `positive-over-five-minutes` | Positive validity exceeds five minutes | Consumer rejects as `invalid_evidence` |
| `principal-mismatch` | Evidence `principalRef` differs from requesting Account binding | Consumer rejects as legacy `principal_mismatch` |
| `replayed-version` | Evidence version is older/equal to an already consumed different effect | Consumer rejects as `replayed_evidence` |
| `unsupported-major` | Contract major is unknown/missing | Consumer rejects as `unsupported_contract` |
| `malformed-envelope` | Required field/decision/reason combination is invalid | Consumer rejects as `invalid_evidence` |

The shared corpus above and its machine-readable fixtures cover normalized evidence outcomes on
both provider and consumer sides. Consumer-side tests additionally prove validation, bounded
entitlement, zero provider I/O in user-facing reads and fail-closed mapping.

The envelope schema and existing single-evidence fixtures remain unchanged. A separate normative
provider sequence corpus for durable acknowledgement, duplicate/out-of-order delivery and
missed-event reconciliation belongs to Telegram Specification #1 and is implemented incrementally
by its provider tickets #3–#8. Repository bootstrap #2 owns no application-runtime corpus. The
applicable sequence cases must pass before the corresponding provider behavior or Platform
integration can be declared complete. Cross-repository integration later joins the independently
passing implementations; production credentials and enablement remain separate owner gates.

## Delivery ownership

- [Platform specification #48](https://github.com/sachkov-inside/platform/issues/48) owns
  sign-in, Account, Member Profile, authorization, entitlement and the
  consumer/test adapters.
- [Platform #49](https://github.com/sachkov-inside/platform/issues/49) delivers IdP/Account flow,
  [#50](https://github.com/sachkov-inside/platform/issues/50) ContentAccess/entitlement,
  [#51](https://github.com/sachkov-inside/platform/issues/51) Account/Member Profile и
  [#52](https://github.com/sachkov-inside/platform/issues/52) final convergence.
- [Workspace #60](https://github.com/sachkov-inside/workspace/issues/60) synchronizes this contract,
  shared harness routing and the created Telegram repository topology after explicit owner
  confirmations; it does not wait for completed Platform protected-content implementation.
- [Telegram Specification #1](https://github.com/sachkov-inside/inside-telegram/issues/1) owns
  `/start` linking, BotContact, uniqueness/recovery, durable member-status event ingestion,
  `getChatMember` reconciliation and provider-side contract tests.

General commands, broadcasts/campaigns, marketing, notification preferences, Tribute/billing,
anonymous internet-public profiles, social graph, production deployment and credentials remain
outside this cross-repository contract. Telegram v1 may own ordinary/tokenized `/start` and bounded
transactional responses under its own Specification. Member-status updates are included only as
Membership Evidence input; they do not create a general messaging platform.
