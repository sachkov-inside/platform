# Platform

Platform is the canonical home of Inside materials and the place where visitors and Membership
participants discover and read them. This glossary names the durable content concepts shared by
product and application work.

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
locators, status and errors remain Video facts and never enter the document.
_Avoid_: Inline video node, iframe block, provider URL as Material content

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
