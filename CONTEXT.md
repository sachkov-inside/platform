# Platform

Platform is the canonical home of Inside materials and the place where visitors and Membership
participants discover and read them. This glossary names the durable content concepts shared by
product and application work.

## Language

**Material**:
A durable, independently discoverable unit of Inside content. In Russian product language:
«Материал».
_Avoid_: Post, publication, lesson, публикация

**MaterialRevision**:
A complete state of one Material's content and metadata at a point in its editorial history. In
Russian product language: «Редакция материала».
_Avoid_: Edit, versioned post, ревизия материала, версия материала

**CurrentDraft**:
The MaterialRevision selected for continued editorial work on one Material. In Russian product
language: «Текущая черновая редакция».
_Avoid_: Mutable draft entity, отдельный черновик

**PublishedMaterial**:
The read-only projection of the exact MaterialRevision currently selected for delivery. It may
expose a safe teaser without exposing a protected body. In Russian product language:
«Опубликованный материал».
_Avoid_: Publication entity, mutable published copy

**MaterialBody**:
The validated structured content snapshot owned by a MaterialRevision. Its persisted schema is
versioned, while the domain term itself is not version-suffixed. In Russian product language:
«Содержимое редакции материала».
_Avoid_: MaterialDocumentV1, HTML blob, editor state

**Topic**:
The single subject area to which a Material belongs. Topics are one level deep in v1.
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
to any number of Series, including none.
_Avoid_: Topic, playlist

**NavigationPage**:
An editorial page that introduces and connects other Platform destinations. Roadmap is a
NavigationPage; Library is instead a generated view of Materials.
_Avoid_: Material, generated index

## Access and activity

**Principal**:
A person or service whose identity and permissions Platform recognizes.
_Avoid_: External Identity, Platform Account, Platform Session

**External Identity**:
A provider-verified identity bound to one Principal independently of changeable profile data.
_Avoid_: Email address, login, Member Profile

**Platform Session**:
A finite authentication context through which Platform recognizes a Principal for subsequent
authorization.
_Avoid_: Principal, Membership, permission

**Platform Account**:
The private Platform state through which a human Principal manages identity, security, linking and
recovery.
_Avoid_: Member Profile, Principal, Membership

**Member Profile**:
A presentation of a human Principal that is visible only to active Inside members and never grants
identity, Membership or content access.
_Avoid_: Platform Account, public internet profile, identity record

**MembershipEvidence**:
A time-limited statement about a Principal's Membership in the canonical closed Telegram chat.
_Avoid_: MembershipEntitlement, Tribute subscription

**MembershipEntitlement**:
Platform's time-bounded conclusion that a Principal currently has Inside Membership access.
_Avoid_: Subscription, Telegram membership status

**ReadingState**:
The current read or unread relationship between a Principal and a Material.
_Avoid_: Progress, completion percentage
