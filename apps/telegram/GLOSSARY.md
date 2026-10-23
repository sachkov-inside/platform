# Telegram application terms

[Root GLOSSARY](../../GLOSSARY.md) owns all shared Inside meanings, including Product,
TelegramIdentity, Product Access and MembershipObservation,
Notification Delivery, CommunityEntitlement and AdmissionRestriction.
This glossary owns only the Telegram application's local terms.

## Language

**BotContact**:
A Telegram person who has started the Sachkov Inside bot and can receive bot messages while
Telegram permits delivery. A BotContact may exist without an Account link or Product Access.
_Avoid_: Subscriber, member, lead

**PlatformLink**:
The historical association between one TelegramIdentity and one opaque Account reference.
It grants neither Product Access nor community admission.
_Avoid_: Login, Membership link, Account merge

**LinkTransaction**:
A short-lived, single-use invitation from an authenticated Account flow to prove and confirm
one PlatformLink through the bot.
_Avoid_: Referral, auth session, permanent link token

**SignInRequest**:
A short-lived, single-use request to prove a Telegram identity for sign-in, bound to the initiating
browser and explicit approval in the bot. It neither creates Product Access nor joins a community.
_Avoid_: LinkTransaction, PlatformLink, access grant, Telegram membership

**Contactability**:
The current ability to deliver bot messages to a BotContact through Telegram. Blocking the bot
changes Contactability without deleting the BotContact, PlatformLink, or Membership history.
_Avoid_: Consent, Membership, active subscription

**Marketing consent**:
A BotContact's explicit choice about marketing messages: the consent button or `/resume` grants
it and turns marketing on, `/stop` withdraws it and turns marketing off. Marketing enabled by
default is not Marketing consent. Each choice is reported to Platform's sales funnel.
_Avoid_: Contactability, opt-in by `/start`

**CommunicationTemplate**:
An author's saved message snapshot that can be reused in communication steps and broadcasts.
Editing a template does not change an already published communication.
_Avoid_: Published post, delivered message, Material

**AuthorMode**:
An explicit request by an authorized, linked Telegram person to save the next supported message
as a CommunicationTemplate.
_Avoid_: Marketing subscription, publication, Account permission

**CommunityDesiredState**:
The one CommunityEntitlement per Account this application is currently trying to make true in the
canonical chat, together with what it last observed there.
_Avoid_: Membership, roster entry, cached status

**CommunityEffect**:
One intended change in the canonical chat for one desired state: opening admission, approving a
join, or ensuring absence. It records attempts; it never issues a right.
_Avoid_: Job, task, command

**DispatchPermit**:
Platform's short-lived confirmation that a specific effect attempt is still current. It authorizes
one attempt and is not a reservation of the outcome.
_Avoid_: Lock, token, approval

**AdmissionLink**:
A short-lived bot-created join-request invite bound in our own database to one intended identity
and desired revision. Holding it is not membership.
_Avoid_: Invite, referral link, access link

**Course Activation Attempt**:
A durable private Telegram request to check a Platform course rule and continue after browser-owned
Account linking.
_Avoid_: Grant, login credential

**Activation Announcement**:
The owner's message in a prior course group, sent from the bot only by the owner, whose button opens
the owner link `/start a_<code>`. It starts no check by itself; pressing it does.
_Avoid_: Broadcast, mailing, grant

**Activation Review Request**:
The owner's queue entry for a person whose owner link confirmed no ground. It records the outcomes;
the owner's decision establishes Product Access in Platform, never a Telegram-owned right.
_Avoid_: Support ticket, rejection, pending_review

**Activation Source**:
An owner-configured prior-course group and participant policy used to verify eligibility for course
activation. It is separate from the community a Product opens and does not itself grant Product Access.
_Avoid_: Community group, subscription source, Product Access
