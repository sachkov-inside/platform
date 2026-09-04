# Platform

Platform is the canonical home of Inside materials and the application where visitors, Membership
participants and Workshop learners use Inside products. This glossary names the durable concepts
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

**Topic**:
The single subject area to which a Material belongs. Topics are one level deep in v1 and have an
immutable slug plus mutable name and summary. Archiving removes a Topic from new assignments and
public discovery while preserving existing Material relations and its canonical reader.
_Avoid_: Category, section

**Format**:
The single primary way a Material is consumed, such as text, video or guide. It is independent of
Topic and is not the kind of an attached file.
_Avoid_: Content type, asset type

**Tag**:
A managed label used to connect and retrieve Materials across Topics and Formats. A Material may
have any number of Tags, including none.
_Avoid_: Free-form keyword, hashtag

**Series**:
An ordered collection of Materials with its own meaning and reading sequence. A Material may belong
to any number of Series, including none. Its Topic relation is derived from published Materials,
never authored directly. A Series has an immutable slug plus mutable name and summary; archiving
preserves its composition and canonical reader but removes it from new assignments and discovery.
In the Russian product interface: «Плейлист».
_Avoid_: Topic, Playlist as a domain term

**NavigationPage**:
An editorial page that introduces and connects other Platform destinations. Roadmap is a
NavigationPage; Library is instead a generated view of Materials and is labelled «База знаний» in
the Russian product interface.
_Avoid_: Material, generated index

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
Attachment, which Platform may only detach.
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

**Member Profile**:
A presentation of an Account that is visible only to active Inside members and never grants
identity, Membership or content access.
_Avoid_: Account, public internet profile, identity record

**MembershipEvidence**:
A time-limited statement about an Account's Membership in the canonical closed Telegram chat.
_Avoid_: MembershipEntitlement, Tribute subscription

**MembershipEntitlement**:
Platform's time-bounded conclusion that an Account may access Membership-scoped surfaces,
including protected Library content and Member Profiles. It does not authorize Workshop content.
_Avoid_: Subscription, Telegram membership status, WorkshopEntitlement

**ContentAccess**:
Platform's authority for the availability and protected delivery of a Material or its linked
Resource to an Account or visitor.
_Avoid_: Paywall middleware, UI lock state, Membership role

**ReadingState**:
The current read or unread relationship between an Account and a Material.
_Avoid_: Progress, completion percentage

**VideoPlaybackProgress**:
A coarse resume position for one Account and one local Video identity. Replacement Video therefore
starts independently, and playback progress never changes ReadingState.
_Avoid_: Material completion, read status, Kinescope user profile

## Production Workshop

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
A time-bounded Platform grant for protected Workshop content. One active Inside subscription
currently creates and renews it alongside, but separately from, MembershipEntitlement.
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
