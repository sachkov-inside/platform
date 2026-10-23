# Inside and Platform

Platform sells access to Inside Products and shows free Materials to everyone in the Public Feed
([ADR 0033](docs/adr/0033-product-tariff-payment-model.md)). The
[current product brief](docs/product/platform-mvp-brief.md) owns delivery scope and the boundary
between editorial originals and published application state. This glossary owns the shared Inside terms and their Platform refinements.
[Telegram application terms](apps/telegram/GLOSSARY.md) owns only the bot-specific language.
[The shared brief](docs/product/README.md) owns overall product scope;
[the access model](docs/product/access-model.md) owns commercial composition and independent right terms.

## Language

**Material**:
A durable, independently discoverable unit of Inside content with one current mutable body,
metadata, access class and publication state. A Material is either free or closed; a closed
Material belongs to at least one Product. In Russian product language: «Материал».
_Avoid_: Post, publication, lesson, публикация

**PublicationState**:
The current visibility lifecycle of a Material: Draft has never been published, Published is
reader-visible, and Unpublished was previously visible but is now hidden.
_Avoid_: Revision pointer, publication entity

**MaterialBody**:
The current structured content owned by a Material. In Russian product language: «Содержимое
материала».
_Avoid_: MaterialDocumentV1, HTML blob, editor state

**Material Block Registry**:
The single description of every block a MaterialBody may contain: node type, fields, field rules,
rendered shape, search text and headings. It lives in `@inside/material-blocks`; the server, the
editor and the reading client all read the same entry instead of keeping their own copy.
_Avoid_: Block schema copy, editor extension list, ContentSchema capability

**Lesson Block**:
A typed block a lesson is assembled from, beyond running text: a callout of a named kind, an
external resource card, an agent prompt, the takeaways of a lesson, a labeled list of terms and a
key point. The platform owns how each one looks, so the same block reads the same in every
Material. In Russian product language: «блок урока».
_Avoid_: Custom layout, embedded HTML, per-lesson styling

**Callout Kind**:
The named kind of a callout: note, tip, warning, example, good, bad, definition or task. The kind
is what a reader sees as a word, an icon and a color; the optional callout name is the author's
own title beside it. In Russian product language: «вид врезки».
_Avoid_: Callout color, callout style, callout severity

**Public Material Projection**:
The indexable body-free view of a Published Material: title, description, cover, author, taxonomy
and publication date. A membership Material remains discoverable through this projection while its
body and body-linked resources stay protected.
_Avoid_: Teaser revision, public body, access decision

**Content Cover**:
A dedicated public image owned by exactly one Material, Topic or Product. Platform keeps only
normalized responsive renditions; replacement and removal detach the old cover, and API
projections never expose originals, storage keys or checksums. In Russian product language:
«Обложка».
_Avoid_: MaterialAsset, shared media-library image, original upload

**Link Preview**:
The public card a Material, Product, Topic or the home page shows wherever its link is opened: title,
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

**Public Feed**:
The stream of free published Materials that every visitor, signed in or not, can read. Closed
Materials are not in it; their locked cards appear in a Product's programme, search and Topic
pages. A free Material of a Product appears both in the Public Feed and in the Product's programme. In Russian
product language: «лента».
_Avoid_: Library subscription, Product, closed Material

**Access Class**:
Whether a Material is free or closed. A free Material is open to everyone; a closed Material opens
only to an Account with access to a Product that contains it. There is no closed Material outside
Products.
_Avoid_: Membership, paywall flag

**Product**:
A standalone Inside learning programme with an authored sequence of reusable Materials and the only
thing Platform sells access to. In Russian product language: «Продукт»; the showcase names an
individual Product by its kind, such as «курс». An archived Product is withdrawn from the showcase
and sale: holders keep reading its programme and Materials, and others get «not found».
_Avoid_: Subscription, «руководство» as the product name, using course as the universal category

**Product Intake**:
A particular upcoming admission to a Product, with an identity that remains stable when its
presentation or dates change. A later admission is a different intake.
In Russian product language: «набор».
_Avoid_: Product, ProductCohort revision, sales opening date

**Product Waitlist**:
An Account's explicit request to hear in Telegram when admission to one Product Intake opens.
Withdrawing and rejoining change the same Account's membership. This request neither grants
learning or community rights nor changes general messaging preferences.
In Russian product language: «список ожидания».
_Avoid_: Bot start, marketing consent, reservation, purchase

**ProductProgramme**:
The reader-facing surface that carries a Product's Materials, their chapters, access states and
progress, and the Product's own price. It is separate from the product page, which explains the
Product and does not sell it by itself; only a Product with a Cohort names the stage and, when it is
on sale, the price on its first screen.
_Avoid_: Product page, route, catalog

**ProgrammePlacement**:
One position of a Material in a Product's programme. Repeated positions share the same Material and studied mark.
_Avoid_: Material copy, catalogue membership

**ChapterAttachment**:
An additional Material linked to a Product chapter outside its mandatory programme.
_Avoid_: Mandatory step, additional chapter

**ProductOnboarding**:
The Product's initial learner path through Telegram linking, community joining and starting learning.
It applies only to a buyer with current paid access to that Product and its community.
_Avoid_: Global community setup, payment confirmation

**ProductAccessRevocation**:
The owner's explicit withdrawal of one Account's Product Access, separate from closing sales or
refunding a Payment. It preserves other Products, financial history and learning progress.
_Avoid_: Refund, selecting one grant source, Account ban

**Product Page Description**:
The author-written description of a Product, kept in its Engineering Content original and transferred to
Platform as an ordered list of typed blocks — a lead, cards, plain text, numbered steps, a short
list, an invitation to the free lessons — plus an optional Home-card caption. The Product's own
`presentation` field names which set of page and Home-card components draws the description; access
terms belong to the Product.
_Avoid_: Product introduction, landing copy in code, presentation chosen by address

**Product Chapter**:
An optional named group in a Product's main path, without owning copies of Materials.
_Avoid_: Video chapter, Material, separately purchased Product

**Product Introduction**:
The author's own answer, on the Product, to what a reader will be able to do, who the Product is
written for, what they need beforehand and what it leaves outside. Its four fields carry the
authoring base wording unchanged, an unwritten field is absent rather than empty, and none of it
is an access decision. In Russian product language: «О продукте».
_Avoid_: Summary, marketing page, access condition, price

**Product Artifact**:
A standalone practical result a reader takes away — a template, configuration or checklist — with
a permanent identity, a version history and either stored bytes or one explicitly external
address. It lives outside every MaterialBody, is reused across Products through separate placements
rather than copies, and its `origin` says whether the Platform editor or the Engineering Content
authoring base owns the record. Replacement opens a new version and keeps the identity and the
placements; delivery goes through ContentAccess. In Russian product language: «Артефакт».
_Avoid_: MaterialAsset, supplementary Material, inline attachment, Content Cover

**Product Task**:
A checkable part of a Product Chapter's result that the learner builds and submits. Its requirements
include an introduction or situation, required and additional criteria, and the freedom the learner keeps.
It belongs to exactly one chapter of one Product, has its own order inside that chapter, its own
access class and a short permanent code. A standalone Task appears after its authored Material
anchor or at the chapter's start. Embedded practice binds one Task to one main Material of its
chapter and renders its submission workspace within that Material. Legacy Tasks keep direct access
and history without a programme row. It is not a Material and not a step of
the Product's main path, so it carries no lesson number and Product Progress does not count it. In
Russian product language: «Задание».
_Avoid_: Assignment, Production Case, stage, точка сдачи, task callout, tracker task

**Task Version**:
An immutable snapshot of a Product Task's requirements, including criterion explanations, advice
and accepted evidence when the author supplies them. A
change of the requirements creates the next version; title, access, related Materials and
publication do not. In Russian product language: «Версия требований».
_Avoid_: Revision, content version, edition

**Task Submission**:
A learner's record of work on one Task Version, with an optional Review Report, the learner's
note and an optional service mark of the reviewed repository, branch and commit. It comes from the
learner's agent over the learning MCP or from the task page form; a form submission carries no
Review Report, only an optional report as plain text. Submissions are
only added; a new submission never replaces an earlier one. It is not a grade or an acceptance
status. In Russian product language: «Сдача».
_Avoid_: Attempt, grade, acceptance, solution upload

**Review Report**:
The learner's own agent's report inside a Task Submission: exactly one status per criterion of its
Task Version — confirmed, violation or not verified — with the evidence, the remaining gap and
whether the evidence came from running a command, with an optional short summary. It is the agent's statement, untrusted text for
the author, never a Platform verdict. In Russian product language: «Отчёт проверки».
_Avoid_: Grade, verdict, test result, Platform check

**Self-check Attempt**:
A saved Review Report of one learner on one Product Task. A new saved report adds the next attempt,
including an unsuccessful report. The first successful attempt confirms every required criterion of
its Task Version. A submission without a Review Report and a repeat of the same saved submission
add no attempt. The result describes the learner agent's self-check, never acceptance by the author.
In Russian product language: «Попытка самопроверки».
_Avoid_: Agent session, grade, author acceptance

**Author Feedback**:
The author's optional comment and «посмотрел автор» mark on one Task Submission, kept apart from
the submission and changed only by the author. It is not a grade. In Russian product language:
«Комментарий автора».
_Avoid_: Grade, acceptance, review status

**Product Mode**:
One of the two ways a reader goes through a Product: on the worked example the author prepared, or
on the reader's own project. It belongs to the reader, not to a Material: one stored choice covers
every Product, and it changes only what a Variant Step shows, never access, order or progress. In
Russian product language: «Режим прохождения», with «Учебный проект» and «Свой проект».
_Avoid_: Difficulty, access class, Product Step Sequence, separate Product copy

**Variant Step**:
A step of a lesson written for both Product Modes, carrying one branch per mode. A branch may be
missing: such a step belongs to its own mode alone and is not shown in the other. The reader sees
the branch of the active mode and can open the other one in place, which changes nothing that is
stored. Both branches stay in the lesson's search text, and the step — not a branch — is what
progress and bookmarks address. In Russian product language: «Вариантный шаг».
_Avoid_: Callout, separate Material, access variant, A/B test

**Lesson Difficulty**:
How hard one lesson is for the reader who opens it: basic, intermediate or advanced. It is the
Material's own fact, so a lesson reused in two Products keeps one answer, and a Material that
declares none simply shows none. In Russian product language: «Сложность».
_Avoid_: Product Mode, access class, Product-level rating

**Lesson Outcomes**:
What the reader can do after one lesson: two to four written points, or none at all. They come
from the Material's data and are not repeated in its body; a published lesson carries either no
points or a real list, never a single one. In Russian product language: «Чему научишься».
_Avoid_: Product Introduction, Summary, Takeaways block

**Product Step Sequence**:
An explicitly named connection between some Materials within one Product. Its steps follow the
Product order even when other Materials appear between them. The same Material may have a different
connection or none in another Product. It does not rank Materials by importance or create another
reading path. In Russian product language: «Последовательность шагов».
_Avoid_: Module, Track, main/optional role

**NavigationPage**:
An editorial page that introduces and connects other Platform destinations. Roadmap is a
NavigationPage; Library is instead a generated view of Materials and is labelled «База знаний» in
the Russian product interface.
_Avoid_: Material, generated index

**ContentLibrary**:
The read capability that builds coherent, body-free projections of current Published Materials,
Topics and Products for Home, Library and discovery pages. Home is a bounded projection of this same
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
Attachment, which Platform may only detach. A Platform Upload its Material has not selected, and
whose outcome Platform has not settled, stays that Material's unselected upload and returns to its
author; a settled outcome the author already saw, and a Video the author removed, are their own
decision, whatever the provider reports afterwards.
_Avoid_: Inline video node, iframe block, provider URL as Material content

**VideoDeletion**:
A durable request to delete one Platform Upload after a successful Material Save has removed every
current and published reference. It remains observable through requested, deleting, deleted or
failed state; ordinary detach and replacement never create it.
_Avoid_: Automatic cleanup, remove button, external video deletion

## Access and activity

**Account**:
Platform's stable private identity for one authenticated human. It owns Platform permissions and
is independent of profile presentation and Account Rights.
_Avoid_: Principal, External Identity, Platform Account, Platform Session, user

**Billing Contact**:
An optional Account-owned verified email for service notifications, independent of its sign-in identity.
A pending replacement becomes the contact only after verification.
_Avoid_: login email, email fingerprint, Account identity

**Order Email**:
The email chosen for one purchase and its receipt, without proof of ownership or a change to the purchasing Account.
It is the fallback for purchase messages when the Account has no Billing Contact.
_Avoid_: Billing Contact, login email, verified identity

**Legal Edition**:
One published version of a legal document, identified by its document key, version number,
effective date and the SHA-256 of its exact text. A published edition never changes: a correction
is the next version, and the earlier text stays readable at its own address.
_Avoid_: draft, current page content, document without a version

**Legal Acceptance**:
An immutable record of an Account accepting an exact legal edition through an explicitly labelled
action, such as accepting terms at sign-in or an offer when buying a Product. Sign-in acceptance
does not stand in for acceptance of purchase conditions.
_Avoid_: consent checkbox, current legal text, payment permission, preselected checkbox

**Platform Administrator**:
An Account explicitly granted all known Platform operations through `platform:admin`.
Its authority is read from current Account grants, never inferred from author access or provider roles.
_Avoid_: author, member, Telegram administrator

**Member Profile**:
The owner's own presentation of an Account: display name, bio and avatar visible only to that
Account. It is never shown to other members or visitors and never grants identity, Account Rights or
content access.
_Avoid_: Account, public internet profile, identity record

**MembershipEvidence**:
A time-limited statement about an Account's Membership in the canonical closed Telegram chat.
_Avoid_: Account Rights, Tribute subscription

**Account Rights**:
Platform's current conclusion about which Products an Account holds and the participation in
community that comes with those Products.
_Avoid_: Subscription, Telegram membership status, library access

**ContentAccess**:
Platform's authority for the availability and protected delivery of a Material or its linked
Resource to an Account or visitor.
_Avoid_: Paywall middleware, UI lock state, Membership role, Account Rights

**ReadingState**:
The current manual read or unread relationship between an Account and a Material, independent of
Account Rights and the Product from which it was opened. It records personal acknowledgement, not
verified understanding.
_Avoid_: Playback position, verified mastery, completion percentage

**ReadingActivity**:
An Account's private material acknowledgement and opening activity. Opening and marking a Material
read are different facts.
_Avoid_: Product analytics, ContentAccess, learning assessment

**Product Progress**:
The number of currently published Materials in a Product's programme that an Account has marked
read. Progress, continuation, the programme and chapter tables of contents count the same
composition. A non-empty Product is currently all read only when every such Material is marked.
_Avoid_: Historical completion certificate, stored course percentage

**VideoPlaybackProgress**:
A coarse resume position for one Account and one local Video identity. Replacement Video therefore
starts independently, and playback progress never changes ReadingState.
_Avoid_: Material completion, read status, Kinescope user profile

**Bookmark**:
A private `Account ↔ Material` relation recording that the Account saved the Material to return to
later. It is the presence of the relation, not access: it never grants the right to read a body or
its linked resources, survives the loss of Account Rights and adds no public field. In Russian product
language: «Закладка».
_Avoid_: Product Access, ReadingState, collection, favorite

## Product purchases and access

**Cohort**:
The current sales run of a Product: a name, a sales stage (announcement, preorder, running, between
cohorts), a calendar start date and the next event. The owner switches it in the catalogue. The stage
decides what the product page promises; money is taken only while the Product is on sale.
A new price does not change access already received. In
Russian product language: «Поток».
_Avoid_: Tariff, Subscription period, a separate copy of the Product, funnel period, prior participants

**Product Removal**:
The confirmed withdrawal of a published Material from a Product whose holders still have access. The author confirms each such Product explicitly, and the removal is journaled with the
number of holders; a Product without holders needs no confirmation. In Russian product language:
«снятие из продукта».
_Avoid_: Unpublish, reorder, access revocation

**ActivationRule**:
A published or paused path through the bot from a verified prior-course source, such as membership
in the prior course group, to lifetime access to the course Product. Its code selects the path;
possession of the code does not prove entitlement.
_Avoid_: Invite link, payment proof, grant, Tribute subscription

**SourceEntitlement**:
A verified external basis identified by its source policy and person, which can exist before an Account is linked.
Repeated verification of the same source policy and identity does not create another access grant.
The prior course group is the source for course activation.
_Avoid_: Telegram presence, Account, Tariff Assignment

**AdmissionRestriction**:
A moderation or externally reported restriction on admission to the community, independent of content rights.
_Avoid_: Expired tariff, revoked materials, failed payment

**OneTimePurchase**:
An Account's purchase of one Product under agreed conditions. Its confirmed Payment and the
resulting access are distinct facts; it creates no renewal or scheduled charge.
_Avoid_: Subscription, paid period, renewal

**PaymentAttempt**:
One recorded attempt to obtain a specific payment outcome, including an unresolved outcome after
sending a request. It is not proof that a payment succeeded.
_Avoid_: Retry, paid period, confirmed payment

**Payment**:
A confirmed transfer associated with one Account and agreed purchase conditions.
Its refund and the owner's decision to withdraw Product access are separate facts.
_Avoid_: Browser return, grant, subscription

**RefundDecision**:
The owner's decision, following a personal request, about the amount and basis of a Payment refund.
The owner performs the refund through the bank and withdraws Product access separately.
_Avoid_: Refund attempt, access revocation, dispute

**Product Access**:
One Account's lifetime access to one Product, including its evolving published Materials and
community, with a history of receipt, withdrawal and restoration. Purchase, verified course
activation and owner issuance establish the same access; receiving it again does not restart Support.
_Avoid_: Tariff Assignment, Direct Right, Lifetime Access Grant, independent grants for the same Product

**CommunityEntitlement**:
An Account's effective right to participate in a Product's configured community, distinct from
actual Telegram membership. Several Products can share one group; their valid community rights combine.
_Avoid_: ChatMember, membership observation, tier name as the rule

**CommunityDelivery**:
One attempt to make a CommunityEntitlement real in Telegram. Its desired state, the provider's
acceptance and the observed membership are separate facts.
_Avoid_: Queue acknowledgement as membership, entitlement revision as proof of admission

**BillingNotice**:
A fact about a Product purchase or its Payment that calls for a service message to the buyer.
It is distinct from the message and its delivery.
_Avoid_: Notification, Delivery, email, reminder job

**Prior Participants**:
People who took part in the previous Inside course and are verified by the bot through the prior
course group. Each receives lifetime access to the course Product. A new Inside-driven
join does not add a participant.
_Avoid_: Current chat roster, all new members, Cohort

## Notifications

**Notification**:
Сообщение для одного Account по определённому событию продукта. Оно имеет назначение и может
доставляться по нескольким каналам независимо.
_Avoid_: Событие продукта, рассылка, попытка отправки

**Notification Delivery**:
Delivery of one Notification through one channel to an eligible recipient: a verified channel contact or the Order Email for purchase messages.
One channel result neither determines another channel result nor proves that the recipient read the message.
_Avoid_: Notification, broker acknowledgement, прочтение

**Publication Announcement**:
Повод сообщить читателям о материале: он возникает один раз, когда Material публикуется впервые,
и принадлежит самому материалу, а не его месту в продукте. Повторная публикация,
переименование, перестановка и включение в другой продукт его не создают. В русском языке
продукта: «анонс первой публикации».
_Avoid_: Publication event, рассылка, повторный анонс

## Sales funnel

**Sales Funnel**:
The owner's aggregated view of how far the people who first entered the bot in a period have got
towards buying one Product: entered, gave marketing consent, opened the chosen chapter, reached
checkout, paid. The period chooses the cohort; later steps count who of it has reached them so far.
Bot steps count bot contacts, the later steps count Accounts. In Russian product language:
«Воронка продаж».
_Avoid_: Events of the period, conversion of one person, the Product's Cohort

**Source Label**:
The label of the bot link a person first entered the bot through, such as `m_survey`. An Account
takes the label of its linked bot contact and keeps it after an unlink; an Account without a known
bot entry has none. It is an
observation of the first entry, not a proven cause of a purchase. In Russian product language:
«метка источника».
_Avoid_: UTM, campaign, attribution model, referrer

## Shared Inside terms

**Support**:
The author's help with a Product promised for a stated term, independent of lifetime Product Access.
In Russian product language: «Сопровождение».
_Avoid_: Lifetime personal support, separately purchased renewal, community participation

**TelegramIdentity**:
The provider-verified Telegram identity from which bot updates originate; it may be linked to an
Account through the Telegram application. It is independent of an Account, BotContact and username.
_Avoid_: Username, BotContact, Account

**Membership Signal**:
The current presence of a linked TelegramIdentity in the Canonical Membership Chat.
_Avoid_: Tribute subscription, payment status

**MembershipObservation**:
A Telegram-owned observation of a Membership Signal at a specific time.
_Avoid_: Permanent member flag, entitlement

**Canonical Membership Chat**:
The single closed Telegram chat whose current roster is the Membership Signal for Inside.
_Avoid_: Community directory, Tribute roster, audience segment

**Supplementary Material**:
A Material associated with a Product outside its main reading path, for reference or additional study.
Its role is specific to that Product and does not change the Material's Format.
_Avoid_: Product Chapter, copied Material, automatically free content

**Subject**:
The anonymous visitor or authenticated Account whose access is being decided.
_Avoid_: Telegram user, authentication context

**Resource**:
A Platform material body, asset, download, or video governed by publication state and access class.
_Avoid_: URL, provider object, storage key

**AccessDecision**:
The allow or deny outcome for one Subject, Action, and Resource, including its reason and validity.
_Avoid_: Boolean Membership check, provider response

## Compatibility names

These names refer to the same concept; they do not introduce another right or product.

| Compatibility name | Canonical term |
|---|---|
| Access Grant | Product Access |
| Community Entitlement | CommunityEntitlement |
| Admission Restriction | AdmissionRestriction |
| Product Purchase | OneTimePurchase |
| BillingContact | Billing Contact |
