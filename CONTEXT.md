# Platform

Platform publishes Inside Materials and Guides for visitors and Membership participants. The
[current product brief](docs/product/platform-mvp-brief.md) owns delivery scope and the boundary
between editorial originals and published application state. This glossary names the concepts
shared by product and application work.

## Language

**Material**:
A durable, independently discoverable unit of Inside content with one current mutable body,
metadata, access class and publication state. In Russian product language: «Материал».
_Avoid_: Post, publication, lesson, публикация

**PublicationState**:
The current visibility lifecycle of a Material: Draft has never been published, Published is
reader-visible, and Unpublished was previously visible but is now hidden.
_Avoid_: Revision pointer, publication entity

**MaterialBody**:
The current structured content owned by a Material. In Russian product language: «Содержимое
материала».
_Avoid_: MaterialDocumentV1, HTML blob, editor state

**Public Material Projection**:
The indexable body-free view of a Published Material: title, description, cover, author, taxonomy
and publication date. A membership Material remains discoverable through this projection while its
body and body-linked resources stay protected.
_Avoid_: Teaser revision, public body, access decision

**Content Cover**:
A dedicated public image owned by exactly one Material, Topic or Guide. Platform keeps only
normalized responsive renditions; replacement and removal detach the old cover, and API
projections never expose originals, storage keys or checksums. In Russian product language:
«Обложка».
_Avoid_: MaterialAsset, shared media-library image, original upload

**Link Preview**:
The public card a Material, Guide, Topic or the home page shows wherever its link is opened: title,
description, canonical address and one preview image. The image is the owner's Content Cover when it
exists and a generated card with the page title otherwise. A closed Material keeps its Link Preview
while its body stays protected. In Russian product language: «Карточка ссылки».
_Avoid_: OG tags, meta preview, share image

**Topic**:
The single subject area to which a Material belongs. Topics are one level deep in v1 and have an
immutable slug plus mutable name and summary. Archiving removes a Topic from new assignments and
public discovery while preserving existing Material relations and its canonical reader.
_Avoid_: Category, section

**Format**:
The single primary way a Material is consumed. The Materials domain defines the closed values
`video` (Видео), `guide` (Гайд), and `note` (Заметка). A Material stores that value directly;
there is no editable Format dictionary or separate database entity. Format is independent of
Topic and is not the kind of an attached file. Drafts may leave it unassigned; publication requires it.
The domain schema and material-format integration tests enforce this contract.
_Avoid_: Content type, asset type

**Tag**:
A managed label used to connect and retrieve Materials across Topics and Formats. A Material may
have any number of Tags, including none.
_Avoid_: Free-form keyword, hashtag

**Guide**:
A standalone practical Inside product for a reader task, with an authored sequence of reusable
Materials. In Russian: «Руководство»; distinct from the Material format «Гайд».
_Avoid_: Series, Playlist, Topic, Material format guide

**Guide Chapter**:
An optional named group in a Guide's main path, without owning copies of Materials.
_Avoid_: Video chapter, Material, separately purchased Guide

**Guide Introduction**:
The author's own answer, on the Guide, to what a reader will be able to do, who the Guide is
written for, what they need beforehand and what it leaves outside. Its four fields carry the
authoring base wording unchanged, an unwritten field is absent rather than empty, and none of it
is an access decision. In Russian product language: «О руководстве».
_Avoid_: Summary, marketing page, access condition, price

**Guide Artifact**:
A standalone practical result a reader takes away — a template, configuration or checklist — with
a permanent identity, a version history and either stored bytes or one explicitly external
address. It lives outside every MaterialBody, is reused across Guides through separate placements
rather than copies, and its `origin` says whether the Platform editor or the Inside Content
authoring base owns the record. Replacement opens a new version and keeps the identity and the
placements; delivery goes through ContentAccess. In Russian product language: «Артефакт».
_Avoid_: MaterialAsset, supplementary Material, inline attachment, Content Cover

**Guide Step Sequence**:
An explicitly named connection between some Materials within one Guide. Its steps follow the
Guide order even when other Materials appear between them. The same Material may have a different
connection or none in another Guide. It does not rank Materials by importance or create another
reading path. In Russian product language: «Последовательность шагов».
_Avoid_: Module, Track, main/optional role

**NavigationPage**:
An editorial page that introduces and connects other Platform destinations. Roadmap is a
NavigationPage; Library is instead a generated view of Materials and is labelled «База знаний» in
the Russian product interface.
_Avoid_: Material, generated index

**ContentLibrary**:
The read capability that builds coherent, body-free projections of current Published Materials,
Topics and Guides for Home, Library and discovery pages. Home is a bounded projection of this same
model, not an editorial copy or a second content store.
_Avoid_: Frontend fixture catalog, Home CMS, duplicated publication

**MaterialAsset**:
An immutable non-video image or downloadable file owned by exactly one Material and referenced
inline from its current MaterialBody. It inherits the Material access class and is deliverable only
while ready and currently authorized.
_Avoid_: Media library item, attachment URL, mutable file

**Video**:
A local identity for one Kinescope object owned by exactly one Material. A Material may select at
most one ready Video through nullable `primaryVideoId` outside MaterialBody; provider IDs, embed
locators, status and errors remain Video facts and never enter the document. Its immutable origin
distinguishes a Platform Upload, which an author may explicitly delete, from an External
Attachment, which Platform may only detach. A Platform Upload its Material has not selected stays
that Material's unselected upload and remains offered to the author until it is selected or deleted.
_Avoid_: Inline video node, iframe block, provider URL as Material content

**VideoDeletion**:
A durable request to delete one Platform Upload after a successful Material Save has removed every
current and published reference. It remains observable through requested, deleting, deleted or
failed state; ordinary detach and replacement never create it.
_Avoid_: Automatic cleanup, remove button, external video deletion

## Access and activity

**Account**:
Platform's stable private identity for one authenticated human. It owns Platform permissions and
is independent of profile presentation and Membership.
_Avoid_: Principal, External Identity, Platform Account, Platform Session, user

**Billing Contact**:
An Account-owned verified email for receipts and subscription notifications, independent of its
sign-in identity. A pending replacement becomes the contact only after verification.
_Avoid_: login email, email fingerprint, Account identity

**Consent Evidence**:
An immutable record of one Account explicitly accepting an exact document edition for a given
context. Recurring acceptance is distinct from other kinds and does not itself authorize a charge.
_Avoid_: current legal text, payment permission, preselected checkbox

**Platform Administrator**:
An Account explicitly granted all known Platform operations through `platform:admin`.
Its authority is read from current Account grants, never inferred from author access or provider roles.
_Avoid_: author, member, Telegram administrator

**Member Profile**:
A presentation of an Account that is visible only to active Inside members and never grants
identity, Membership or content access.
_Avoid_: Account, public internet profile, identity record

**MembershipEvidence**:
A time-limited statement about an Account's Membership in the canonical closed Telegram chat.
_Avoid_: MembershipEntitlement, Tribute subscription

**MembershipEntitlement**:
Platform's current conclusion that an Account may access Membership-scoped surfaces, including
protected Library content and Member Profiles, for a finite term or through an independent lifetime
right. It does not authorize Workshop content.
_Avoid_: Subscription, Telegram membership status, WorkshopEntitlement

**ContentAccess**:
Platform's authority for the availability and protected delivery of a Material or its linked
Resource to an Account or visitor.
_Avoid_: Paywall middleware, UI lock state, Membership role

**ReadingState**:
The current manual read or unread relationship between an Account and a Material, independent of
Membership and the Guide from which it was opened. It records personal acknowledgement, not
verified understanding.
_Avoid_: Playback position, verified mastery, completion percentage

**ReadingActivity**:
An Account's private material acknowledgement and opening activity. Opening and marking a Material
read are different facts.
_Avoid_: Product analytics, ContentAccess, learning assessment

**Guide Progress**:
The number of currently published Materials in a Guide that an Account has marked read. A
non-empty Guide is currently all read only when every such Material is marked.
_Avoid_: Historical completion certificate, stored course percentage

**VideoPlaybackProgress**:
A coarse resume position for one Account and one local Video identity. Replacement Video therefore
starts independently, and playback progress never changes ReadingState.
_Avoid_: Material completion, read status, Kinescope user profile

**Bookmark**:
A private `Account ↔ Material` relation recording that the Account saved the Material to return to
later. It is the presence of the relation, not access: it never grants the right to read a body or
its linked resources, survives the loss of Membership and adds no public field. In Russian product
language: «Закладка».
_Avoid_: AccessGrant, ReadingState, collection, favorite

## Deferred Workshop vocabulary

Workshop is deferred while the current platform develops Materials and Guides. These terms retain
the separate Workshop model and implemented foundations; they do not define Guide modules or
expand the current delivery scope. See the
[deferred Workshop contract](docs/specifications/workshop-tracks.md).


**Workshop**:
Inside's practical learning area for active subscribers: thematic Workshop Tracks combine
Materials, local Laboratories and Production Cases. Access remains a separate authority so a
future standalone Workshop grant stays possible.
_Avoid_: Separate current subscription, Material Series, coding puzzle catalog

**Workshop Track**:
A versioned authored thematic path through ordered Track Items. Its order recommends the next
learning step but never creates an implicit unlock rule. In Russian product language: «Трек».
_Avoid_: Program, course, Learning Branch, Topic, skill tree

**Track Item**:
One ordered placement in a Workshop Track that references exactly one Material, Laboratory or
Production Case and presents the target's canonical availability. It neither owns target content
nor changes access policy.
_Avoid_: Lesson, Case Placement, copied Material, prerequisite gate

**Laboratory**:
A versioned guided local experiment in which a learner builds or changes an environment, predicts
behaviour, observes the real system and may record a conclusion.
_Avoid_: Material format, Production Case, hosted sandbox, quiz

**Laboratory Step**:
One ordered experiment with a goal, learner action and observable checkpoint. Prediction,
observation and conclusion prompts are optional and do not gate the next step.
_Avoid_: Test scenario, required reflection, quiz question

**Laboratory Progress**:
An Account's private manual resume state for one exact Laboratory version. It may contain bounded
step notes and is not evaluation evidence or verified mastery.
_Avoid_: Attempt, grade, completion certificate

**Production Case**:
A versioned business engineering problem in which a learner designs and implements a change under
explicit context and constraints. Submission and evaluation are separate policy. In Russian
product language: «Кейс».
_Avoid_: Coding exercise, homework, quiz

**Case Variant**:
One supported technology-specific form of a Production Case that preserves the same observable
learning contract while using its own starter baseline and evaluation assets.
_Avoid_: Separate Case, generated port, Platform stack

**WorkshopEntitlement**:
A time-bounded Platform grant for protected Workshop content. In the first Kafka slice it is
projected from the same accepted MembershipEvidence that keeps MembershipEntitlement current, but
remains a separate authority.
_Avoid_: MembershipEntitlement, route-local membership check, permanent purchase

**WorkshopResource**:
A published Workshop Track outline, Laboratory or Production Case body or artifact governed by
Workshop publication state and canonical access mode. A referenced Material remains a
ContentAccess Resource.
_Avoid_: Material Resource, URL, Track Item, Git source file

**WorkshopAccess**:
Platform's authority for deciding an Account's or visitor's Workshop action on a WorkshopResource.
It consumes public access mode or WorkshopEntitlement without weakening ContentAccess for
referenced Materials.
_Avoid_: ContentAccess, UI lock state, route-local entitlement check

**Assignment**:
One Account's managed working copy of one Case Variant, including its starter baseline and source
repository identity.
_Avoid_: Production Case, repository, checkout

**Attempt**:
An immutable submission of one Assignment at one exact source revision with accepted evaluation
evidence. A push or local test run alone is not an Attempt.
_Avoid_: Commit, run, mutable submission

**AttemptResult**:
The terminal test-based outcome of one Attempt: `Needs work` or `Passed`. `Passed` means the
required Workshop checks passed for the bound source revision, not professional certification.
_Avoid_: MasteryResult, Verified, grade

**SolutionReveal**:
The irreversible record that an Account may access the exact solution for one Production Case
version, either after an Attempt or by explicit early study choice.
_Avoid_: AttemptResult, penalty, completion

`Assignment`, `Attempt`, `AttemptResult` and `SolutionReveal` describe implemented case-first
foundations. They are not the current Kafka evaluation contract until #278 accepts their reuse.

## Subscription and access

**Subscription**:
An Account's agreement for a selected Inside access composition, paid period and renewal terms.
It is distinct from a bank payment and from independently granted access.
_Avoid_: Payment, MembershipEvidence, AccessGrant

**Offer**:
A versioned description of a chosen access composition, independent of a Guide and a payment.
Its payment option specifies the price, period and sale mode: a subscription charged on a schedule,
or a one-time purchase that is paid once and creates no schedule. It carries a reversible `published`
(for-sale) state, separate from permanent archival; while no offer is published, neither the
subscription nor a separately sold Guide is offered anywhere.
_Avoid_: Guide, Order, AccessGrant

**OneTimePurchase**:
A single payment for one Offer that creates no Subscription, no renewal schedule and no recurring
consent. Its AccessGrants carry their own terms and outlive any Subscription.
_Avoid_: Subscription, paid period, renewal

**AccessScope**:
The library, a particular Guide, support or the shared community chat covered by an AccessGrant.
It is independent of a tier's name, price and billing interval.
_Avoid_: Payment status, Telegram presence, subscription duration

**PaymentAttempt**:
One recorded attempt to obtain a specific payment outcome, including an unresolved outcome after
sending a request. It is not proof that a payment succeeded.
_Avoid_: Retry, paid period, confirmed payment

**Payment**:
A confirmed transfer associated with one Account and agreed purchase conditions.
Its refund and the owner's decision about access are separate facts.
_Avoid_: Browser return, grant, subscription

**RefundDecision**:
The owner's recorded decision about one Payment: how much to return, whether access is kept or
revoked, and whether renewal stops. It is separate from the bank attempt that executes it, and an
unresolved or failed attempt is never presented as executed.
_Avoid_: Refund attempt, access revocation, dispute

**PaymentMethodBinding**:
A proven bank permission to charge a saved payment method for one Account's later attempts.
Forbidding its use stops new sends and does not delete the buyer's card at the bank.
_Avoid_: Card, CustomerKey, refund permission

**ScheduledChange**:
An accepted option change that starts with the next period and leaves the paid term unchanged.
An upgrade inside the paid term is a separate payment, not a scheduled change.
_Avoid_: Pending payment, price change, promotion

**AccessGrant**:
One independent reason an Account has specified Inside capabilities for a finite term or for life.
Payment, an owner's manual decision and a confirmed prior entitlement are distinct sources.
_Avoid_: Telegram presence, single global paid flag

**CommunityEntitlement**:
An Account's effective right to participate in the Inside community, distinct from its actual
presence in the Telegram chat.
_Avoid_: ChatMember, membership observation

**CommunityDelivery**:
One attempt to make a CommunityEntitlement real in Telegram. Its desired state, the provider's
acceptance and the observed membership are separate facts.
_Avoid_: Queue acknowledgement as membership, entitlement revision as proof of admission

**BillingContact**:
An Account's confirmed address for subscription communication and receipts.
It is distinct from identity evidence used to sign in.
_Avoid_: Email fingerprint, Telegram username, merchant email

**RenewalConsent**:
An Account's explicit agreement to future charges under identified terms and a confirmed payment
method. Ending it preserves the already paid term.
_Avoid_: Saved card, current chat membership, completed payment

**BillingNotice**:
One occurrence in a Subscription's paid life that is worth a service message: an upcoming charge, a
confirmed or declined payment, a cancelled renewal, an ended access term or a resolved refund. It is
a Billing fact with its own revisions, not the message, the channel or the delivery.
_Avoid_: Notification, Delivery, email, reminder job

**LegacyCohort**:
The separately established set of prior Inside participants whose existing access must be accounted
for during the move to the new subscription. A new Inside-driven join does not add a participant.
_Avoid_: Current chat roster, all new members

## Notifications

**Notification**:
Сообщение для одного Account по определённому событию продукта. Оно имеет назначение и может
доставляться по нескольким каналам независимо.
_Avoid_: Событие продукта, рассылка, попытка отправки

**Notification Delivery**:
Доставка одного Notification по выбранному каналу подтверждённому получателю. Результат одного
канала не определяет результат другого и не означает прочтения.
_Avoid_: Notification, broker acknowledgement, прочтение
