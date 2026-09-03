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
Platform's time-bounded conclusion that an Account currently has Inside Membership access.
_Avoid_: Subscription, Telegram membership status

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
Inside's separate product for practising realistic production engineering situations through
versioned cases, local work and recorded Attempts.
_Avoid_: Membership course, coding puzzle catalog, skill tree

**Production Case**:
A versioned engineering situation with problem context, constraints, executable checks and linked
learning guidance. In Russian product language: «Кейс».
_Avoid_: Task, exercise, challenge

**Case Variant**:
One supported technology-specific form of a Production Case that preserves the same observable
learning contract while using its own starter baseline and evaluator adapter.
_Avoid_: Separate Case, generated port, Platform stack

**WorkshopEntitlement**:
A time-bounded grant from Platform that gives an Account access to a declared Workshop scope and is
independent of MembershipEntitlement after it is issued.
_Avoid_: Membership benefit, subscription, permanent purchase

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
