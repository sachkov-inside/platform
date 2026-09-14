# Owning boundary evidence

Platform full PostgreSQL suite: 465 PASS before final shortening regression; final run recorded in the PR. Actual consumer suites: 28 + 51 PASS. These tests complement the real paired journeys; an injected Platform authorization adapter proves consumer behavior only.

## Row evidence

### 12 — repeat/order/conflict Tribute events

**Owning invariant covered, P-HTTP-PG.** `tribute-sources.test.ts: "12/13/14 official signed inbox deduplicates transport retries, preserves cancel remainder and holds unordered facts"` sends signed HTTP renewal, repeats same semantic event with changed `sent_at` and checks original receipt, applies cancellation, holds changed-expiry conflict and older `created_at` as `pending_reconciliation`. Final persisted Enrollment count is one; end remains exactly `2030-03-01T00:00:00.000Z`.

PAIR complement: `tribute-desktop.json` records `PASS signed HTTP renewal/dedup/cancel retains exact paid remainder on real account`. PAIR does not separately inject every event ordering; owning signed-inbox PG test supplies that boundary. No browser rerun required merely to duplicate the conflict permutation.

### 14 — bad signature/foreign subscription/trial

**Owning invariant covered, P-HTTP-PG.** Same exact test above asserts 401 for bad signature, wrong key, absent signature, and body tamper after signing. Foreign `subscription_id`, `trial`, `gift`, and absent payment type remain pending reconciliation; final one Enrollment/unchanged confirmed term rejects accidental paid extension. These are synthetic protocol fixtures, not evidence of real provider credentials or every undocumented Tribute payload version.

### 20 — hidden/archived catalog

**Owning branches covered, P-PG.**

* `billing-operations.test.ts: "каталог управляется той же поверхностью с проверкой revision"`: unpublished owner catalog stays visible to owner, absent from public sale; quote rejects; accepted subscription snapshot remains.
* `payment-access-matrix.test.ts: "выключение и архивирование продажи не трогают действующий доступ и продление"`: hides then archives paid offer, retains material access and existing renewal; one renewal charge.
* `tribute-sources.test.ts: "pending source keeps its promised tier; changing policy cannot bypass archive, while existing terms remain updateable"`: hidden assignable tier can be promised; archive blocks pending new attach even after policy switches tiers; unarchive permits attach; subsequent archive permits updating already existing source term.
* `tribute-sources.test.ts: "10 preview never infers identity or periods; changed revisions and archived catalog fail closed"`: archive between preview/apply rejects new assignment.

HTTP transport coverage: `billing-pricing-http.test.ts: "public catalog, trusted quote identity, owner authorization and wire conflicts"`. Do not describe direct facet tests as browser actions.

### 21 — stale quote/cache/direct API cannot reopen sale; in-flight settlement

**Owning sales gate and in-flight branches covered, P-PG.** New `billing-operations.test.ts: "21 a quote accepted before unpublish cannot start a new purchase afterward"` obtains real quote and consent before unpublish; afterward direct production purchase returns failure and PG purchase count remains zero. This is precisely the server gate cached UI/stale quotes must cross, although the test itself is not HTTP injection.

`billing-pricing.test.ts: "changed prices, promotion revisions and expiry require a new quote before reservation"` covers changed price/promotion and exact quote expiry. `billing-payments.test.ts: "fulfillment failure replays without bank I/O; saved conditions survive offer archive and PostgreSQL rejects mutation"` protects accepted in-flight conditions. `billing-subscriptions.test.ts: "отмена после отправки сверяет прежнюю попытку: поздний успех даёт период без новых списаний"` reconciles original uncertain charge, preserves late-paid period, creates no second charge. No need manufacture browser cache behavior to retest the same owning gate.

### 22 — excluded new product including direct resources

**Owning authorization/resource delivery covered, P-PG.** `payment-access-matrix.test.ts: "назначение курса проходит body/file/video/artifact и не открывает исключённый продукт"` allows included material/file/video/artifact, denies other Guide/body and forged Guide artifact context; creates a new separate product after grant and denies it; revoke subsequently denies every resource class. `guide-access.test.ts: "guide A allows its shared Material and direct resource only; B, draft and forged guide context stay denied"` plus `"direct file delivery and video tokens use real guide scope facts and recheck revoked access"` explicitly deny excluded Guide asset/video, mismatched material IDs, and previously issued token after revoke.

Boundary: production enforcement/delivery facets with real resource facts, not actual network requests to every URL nor an exhaustive source × resource Cartesian product. PAIR course desktop/mobile proves protected material reader path. Neither frontend hiding nor Telegram adapter result substitutes for these owning checks.

### 24 — old snapshots/terms survive catalog edits

**Direct retained Enrollment/grant snapshot assertion covered, P-PG.** New `tribute-sources.test.ts: "24/26 full enrollment snapshot survives catalog edit and offset periods resolve at exact UTC bounds"` captures complete Enrollment and grants; edits Offer name/revision/benefits/contentScope; asserts both saved values are exactly unchanged. Mutation is a deliberate PG fixture edit, not owner HTTP.

Commercial snapshot complement: `billing-pricing.test.ts: "archive/edit preserve accepted conditions and history; limit cannot shrink below committed usage"` preserves reservation snapshot through archive and settlement; changed-price test above rejects stale new reservations. `billing-payments.test.ts` fulfillment/archive test preserves saved payment conditions. Narrow limit: new 24/26 test does not edit PaymentOption price or separately repeat course origin; do not claim that exact full cross-product was exercised. These are shared snapshot-owner invariants, so this is not a requirement to rerun all origins in a browser.

### 26 — timezone/month-end/future starts

**Owning interval branches covered, P-PG.** Same `"24/26 full enrollment snapshot survives catalog edit and offset periods resolve at exact UTC bounds"`: imports +03:00 starts/ends, checks UTC persisted instants, denies at start−1ms, allows exact start and end−1ms, denies exact end. `account-access.test.ts: "half-open intervals, future starts and finite bounds are exact"` independently exercises future grant boundary. `billing-subscriptions.test.ts: "продление считает срок от исходного anchor и продолжает права без перерыва"` starts Jan31, renews Feb28→Mar31 at exact boundary, checks second grant starts at prior end and duplicate sweep makes no charge. Clock control is intentional deterministic proof; browser sleep is unnecessary. No claim of every timezone/DST combination.

### 27 — foreign/expired invite, stale permit/revision

**Substantial split-owner coverage; remaining precise limit below.** T-V `"rejects foreign and delayed expired invites before an approval effect"`: foreign invite declined; queued valid request processed after expiry produces zero approvals. T-V `"keeps two concurrent workers to one external attempt and admits intended current invite"`: one invite across two workers; intended current request admitted. This is T-PG, with Platform authorization double.

P-PG `community-entitlements.test.ts: "authorization is correlated, replayable and refuses foreign work"` checks correlated five-second permit, immutable replay deadline, conflict on changed attempt, rejection of wrong digest/unknown operation/wrong effect. `"a queued grant cannot admit after an unlink, and the old identity is closed by its own history"` and `"an expired command is refused, and an expired reason cannot remove a live member"` cover stale binding/access reasons. PAIR course desktop/mobile records `PASS intended join via actual Platform v2 dispatch permit`.

Additional current accepted-consumer run: `community-entitlements.integration.test.ts`, `identity-link-recovery.integration.test.ts`, `identity-linking.integration.test.ts`, 51 PASS. This includes “refuses a permit that reaches past its five second window”, stale revisions/old invite and identity conflict/expired-token recovery. `delivery-recovery.json` adds an actual foreign user attempting the intended invite across both running apps.

### 30 — uncertain invite/ban outcome

**Consumer recovery invariants covered, T-PG.** T-V `"uses the exact persisted invite expiry despite clock advancing after commit"`, `"waits for the persisted invite horizon after throw or process death"`: simulated successful external invite then lost reply does not blindly issue another before stored horizon. `"keeps unknown ban outcomes restricted and requires an audited decision to restore"`: uncertain ban remains restricted, explicit audited restore required. `"recognizes an own ban event arriving before its HTTP acknowledgement"` and `"does not overwrite an operator restoration when a superseded ban settles late"` cover effect/ack races.

These tests use actual consumer persistence plus injected Telegram errors/clock; “process death” name includes modeled lost response/reconstruction, not an OS kill claim. They do not create Platform grants. P-PG `"an unknown provider outcome stays unapplied and visible to the operator"` supplies producer observation. PAIR happy-path dispatch already proves composition; repeating each precise consumer fault in browser adds no owning invariant.

### 34 — future synthetic public tier + consent lifecycle

**Local billing lifecycle covered, P-PG with synthetic bank.** `billing-subscriptions.test.ts: "продление считает срок от исходного anchor и продолжает права без перерыва"`, `"отмена до отправки запрещает вызов банка и сохраняет оплаченный срок"`, `"возобновление требует явного согласия и действует только внутри оплаченного срока"`. Shared scenario publishes a synthetic tier/option, verifies billing contact, binds consent document IDs/versions/digests to quote, buys, applies AUTHORIZED/CONFIRMED, fulfills real PG rights, renews/cancels. `payment-access-matrix.test.ts: "новый покупатель оформляет подписку только после решения владельца"` denies unknown buyer with zero bank Init/purchase, then owner confirmed_new permits lifecycle.

This is the requested future local lifecycle, not authority to start real recurring sales. It does not prove an external Tribute subscription was stopped. That remains an operational/business evidence boundary, not something a browser test can manufacture.

### 39 — v1 history, v2 moderation/status, incompatible versions

**Core clauses covered across P-HTTP-PG, T-PG and PAIR.** T-V `"uses exact v2 wire digest including UUID spelling and reads historical v1 receipts"` reads stored v1 status, refuses new v1 set with422 and zero legacy external effects, then uses v2 authorization for actual consumer work. `"does not clear an external or moderator ban on a new right"` proves no automatic unban from new entitlement. P-HTTP-PG `community-entitlements.test.ts: "the dispatch endpoint maps every protocol answer to its exact status"` checks401 auth,409 conflict,422 incompatible contract,400 malformed,200 denied/allowed; wrong digest rejection is checked by the P-PG authorization test named in27.

PAIR `course-desktop.json` and `course-mobile.json` each records `PASS moderation reaches bot and cabinet; repeated start cannot unban; course content remains readable` and intended v2 join. Thus status/moderation presentation is actual two-app evidence, while migration/failclosed branches are owning consumer tests. `portable-equality.json` separately verifies all five portable files and the accepted consumer runtime schema against immutable provider de605c09.

## Additional matrix boundaries

- **3:** `forwarded-course.json` records actual no-grant/no-read; `forwarded-privacy.json` compares that original bot transcript with 152 foreign binding references, none disclosed.
- **4/38:** `course-orders.json` proves actual concurrent two-code ingress, manual-first and activation-first, exact original source/Enrollment/term and lost accepted evidence ACK. Platform `subscription-activation.test.ts` “pending source does not grant; two links and owner assignment share one durable source” and accepted Telegram `subscription-activation.integration.test.ts` cover independent worker concurrency with real PG. A single launched AppModule is not described as two OS worker processes.
- **6/8:** `activation-race.json` holds original consumer bytes during owner pause/revision and for the real five-minute expiry. Platform `subscription-activation.test.ts` “relink after HTTP lookup rejects stale evidence and own-access; refreshed snapshot works and replay stays durable” covers exact binding race. `telegram-account-sign-in.test.ts` “concurrent first Telegram sign-ins converge without email or permissions; another Logto subject cannot claim the identity” and “a lost provider response retains one Account and principal, and a fresh proof repairs the incomplete link” prove no silent merge. Accepted Telegram `identity-linking.integration.test.ts` “returns neutral malformed and expired outcomes without creating a link”, “enforces a ten-minute lifetime and the original Account binding”, and “keeps the same pair idempotent and requires recovery for another Account” cover expired login/occupied binding. These are deterministic owning PG tests, not a claim that the browser waited ten minutes.
- **10:** Platform `tribute-sources.test.ts` “10 preview never infers identity or periods; changed revisions and archived catalog fail closed” proves null identity/expiry and duplicate external recipient handling. Names never authorize matching. “preview flags every period reduction and confirmed-to-temporary downgrade before apply” covers shortening warnings without changing rights during preview; source14 PG tests PASS after this final regression.

## Reproduction and interpretation

From Platform on pinned Node: `pnpm check`, `pnpm test:integration`, `pnpm test:storybook`, `pnpm smoke:fullstack`, `pnpm smoke:enrollments`. Integration tests own disposable PostgreSQL databases. Actual Tribute/browser setup is in the repository runbook and the evidence README; never point tests at a shared acceptance or production database.

From accepted Telegram on pinned Node with a dedicated disposable integration database: `pnpm test:integration test/integration/community-v2.integration.test.ts test/integration/subscription-activation.integration.test.ts` (28 PASS), then `pnpm test:integration test/integration/community-entitlements.integration.test.ts test/integration/identity-link-recovery.integration.test.ts test/integration/identity-linking.integration.test.ts` (51 PASS). Source and Platform grant authority are not replaced by those adapter test results.

Precise timing/negative permutations belong to the service owning the invariant. Actual paired evidence proves HTTP composition, login, content and community delivery. This combination is the local matrix result; external credentials, complete official exports, real dates, legal acceptance and rollout authorization remain separate gates.
