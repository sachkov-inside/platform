# Telegram application terms

[Root GLOSSARY](../../GLOSSARY.md) owns all shared sachkov.dev meanings, including Product,
TelegramIdentity, Product Access and MembershipObservation,
Notification Delivery, CommunityEntitlement and AdmissionRestriction.
This glossary owns only the Telegram application's local terms.

## Language

**BotContact**:
A Telegram person who has started the sachkov.dev bot and can receive bot messages while
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
changes Contactability without deleting the BotContact, PlatformLink, or community history.
_Avoid_: Consent, Membership, active subscription

**Marketing Preference**:
A BotContact's current choice about bot marketing: messages are allowed after starting the bot,
`/stop` turns them off and `/resume` enables future messages without a missed-message backlog.
Separate consent is not a prerequisite, and starting or unblocking the bot does not erase an explicit stop.
_Avoid_: Contactability, Product Access, mandatory opt-in

**Communication Sequence**:
An authored series of messages and waits that one BotContact can enter and progress through.
Its published message snapshots are independent of later template edits and of the Sales Funnel report.
_Avoid_: Funnel, Sales Funnel, Broadcast

**Sequence Participation**:
One BotContact's entry and progress in a Communication Sequence, separate from Product Access,
Product Waitlist membership and Marketing Preference.
_Avoid_: Enrollment, Product Intake, purchase

**CommunicationTemplate**:
An author's saved message snapshot that can be reused in communication steps and broadcasts.
Editing a template does not change an already published communication.
_Avoid_: Published post, delivered message, Material

**Saved Telegram Copy**:
An independent copy kept by the bot for reuse in a CommunicationTemplate, separate from the
message the author originally sent. Removing the original does not remove this copy.
_Avoid_: Original message, publication, backup

**AuthorMode**:
An explicit request by an authorized, linked Telegram person to save the next supported message or completed album
as a CommunicationTemplate.
_Avoid_: Marketing subscription, publication, Account permission

**CommunityDesiredState**:
The latest Platform instruction this application is trying to make true for a linked Account in
the Community Group. It is separate from both the right and observed membership.
_Avoid_: Membership, roster entry, cached status

**CommunityEffect**:
One intended change in the Community Group for one desired state: opening admission, approving a
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

**Главное меню** (Main Menu):
The first screen of the private chat with the bot, which leads to its Разделы. A person sees only
the Разделы that apply to them: Мои продукты with Product Access, the course entry until they
have that course, Управление as an authorised author.
_Avoid_: Start menu, product list, home screen, command menu

**Раздел** (Bot Section):
One part of the bot that the Главное меню opens with its own button: Мои продукты, Тренажёр,
ИИ-модели, Помощь or Управление.
_Avoid_: Tab, module, feature, mode

**Тренажёр** (Trainer):
The bot section where a BotContact checks their knowledge of AI engineering inside one widget
message of the private chat. The person opens it themselves; it needs no PlatformLink or Product
Access and the bot never sends reminders about it.
_Avoid_: Quiz, test, course, Mini App

**Проверить себя** (Self-check):
The main Тренажёр mode: one round of 5 questions from different topics.
_Avoid_: Quick round, Быстрый раунд, exam

**Вопрос дня** (Daily Question):
The one Тренажёр question of a Moscow calendar day, the same for everyone.
_Avoid_: Daily quiz, reminder, question of the week

**Тренировка по теме** (Topic Training):
A Тренажёр round of up to 10 questions from one topic the person chose.
_Avoid_: Course, lesson, module

**Завершённый раунд** (Completed Round):
A Тренажёр round in which the person has answered every remaining question. Only its answers count
in the Тренажёр statistics; their day and week are the day and week the round finished.
_Avoid_: Opened round, shown question, unfinished attempt

**Очки** (Points):
What a person earns after finishing a Тренажёр round: one point for a correct answer that is their
first answer in a completed round to that question and comes within 90 seconds after it was shown.
Points open no access and change no Product or price.
_Avoid_: Score, grade, rating, balance, bonus

**Серия** (Streak):
The number of Moscow calendar days in a row on which a person finished at least one Тренажёр
round. Today without a completed round does not end it yet; a missed day does.
_Avoid_: Series of messages, sequence, run of correct answers

**Цель дня** (Daily Goal):
5 Тренажёр questions credited by completed rounds in one Moscow calendar day. It is only shown: it opens and blocks
nothing.
_Avoid_: Limit, quota, task, daily question

**Рейтинг** (Rating):
The two Тренажёр tables of Очки: «Неделя» (Monday to Sunday, Moscow time) and «Всё время».
Every participant with at least one point in the period appears automatically under their latest
known Telegram name. Participation has no switch.
_Avoid_: Leaderboard, league, tournament, grade, student ranking

**Оценка вопроса** (Question Reaction):
A person's current like or dislike of a question, available after their answer. The same opinion
applies across rounds and modes, can be changed or cleared, and does not change learning credit.
_Avoid_: Answer verdict, points, grade

**Банк вопросов** (Question Bank):
The author's whole set of Trainer questions and their topics, loaded into the bot by the owner's
import. The bot never edits it; a new import replaces what people are shown.
_Avoid_: Quiz, test, lesson check, question pool

**Вопрос тренажёра** (Trainer Question):
One question of the Банк вопросов with a permanent identifier, a topic, 2 to 4 options of which one
or several are correct, an explanation of every option and a general explanation. A question that
leaves the Bank is withdrawn from display and keeps the answers people gave to it. A question may
start from an Условие.
_Avoid_: Lesson question, task, exercise, poll

**Условие** (Question Context):
The situation a person reads on its own screen before a Вопрос тренажёра: the `context` field of
the Bank file. The question's own text then asks about that situation and may be empty.
_Avoid_: Preamble, scenario, case, stem

**ИИ-модели** (AI Models):
The bot section where a BotContact sees the current popular ИИ-модели, their prices and the Подписки
сервисов that include them, inside one widget message of the private chat. Anyone who started the
bot can open it; it needs no PlatformLink or Product Access.
_Avoid_: Catalogue, model catalogue, Product Catalogue, model rating

**ИИ-модель** (AI Model):
One specific model version that a company offers, such as Opus 5.5; one entry of the ИИ-модели
section. A Семейство (Claude) or a tool where people use models (the Codex app) is not an ИИ-модель.
_Avoid_: Model family, provider, agent, tool

**Семейство** (Model Family):
The ИИ-модели one company releases under one name, such as Claude, GPT or Gemini. The ИИ-модели
section groups models by Семейство.
_Avoid_: Company, provider, model line, ИИ-модель

**Мощность** (Power):
How capable an ИИ-модель is compared with the others, by one independent public rating. It orders
models inside a Семейство and Семейства among themselves.
_Avoid_: Ум, intelligence, Рейтинг, score

**Подписка сервиса** (Service Subscription):
Another company's paid plan that gives access to ИИ-модели, such as ChatGPT Plus or Claude Max.
It has nothing to do with sachkov.dev Products, which are never sold as subscriptions.
_Avoid_: sachkov.dev subscription, tariff, Product, Product Access

**Оценка подписки** (Subscription Estimate):
How much work one Подписка сервиса buys in a month, as the same usage priced at API rates and as a
multiple of the subscription price. It comes from independent measurements of at least five accounts
or from a limit the vendor states in dollars, and it is never the vendor's own usage limit.
_Avoid_: Limit, quota, token allowance, tasks per week, guaranteed usage

**Агент** (Agent):
A program in which a person works with an ИИ-модель on tasks, such as Codex, Claude Code or OpenCode.
_Avoid_: Daily check, tool, app, ИИ-модель

**Лучший агент** (Best Agent):
The Агент with the best independent measurement for one ИИ-модель; when no measurement exists, the
one the model's company recommends. Good alternatives are listed with it, and the owner's own
preference is shown separately as their opinion.
_Avoid_: Official app, default agent, owner's pick

**Сводка модели** (Model Summary):
One line on what an ИИ-модель is good for and what it costs in return, such as «самая умная для кода,
но дорогая».
_Avoid_: Description, review, Справочник

**Метка задачи** (Task Tag):
One of a fixed set of task kinds that an ИИ-модель suits: код, тексты, поиск и анализ, агенты, дёшево
и много. The Ежедневная проверка proposes task tags from sources.
_Avoid_: Badge, Значок автора, category

**Значок автора** (Author Badge):
The owner's short opinion shown on an ИИ-модель, from a fixed set: «Мой выбор», «Уверенная», «Для
средних задач», «Дорого», «Невыгодно», «Риск бана». Only the owner sets or removes it; the
Ежедневная проверка never changes it. «Риск бана» describes a service and reaches the models used
through it.
_Avoid_: Tag, Метка задачи, rating, review

**Лучше взять** (Better Pick):
The owner's pointer from one ИИ-модель to one or two others they recommend in its place, with a
reason, such as GLM-5.3 to DeepSeek V4.1 Flash «по цене и качеству». Like a Значок автора, only the
owner sets it and the Ежедневная проверка never changes it.
_Avoid_: Alternative list, similar models, recommendation engine

**Справочник** (Models Reference):
The ИИ-модели data that people currently see, with the date it was last checked. It changes only
when the owner publishes a Черновик справочника.
_Avoid_: Catalogue, snapshot, release, Сводка

**Ежедневная проверка** (Daily Check):
The automatic comparison of the Справочник with vendor and independent sources once a day. It
either confirms the Справочник or produces a Черновик справочника.
_Avoid_: Agent, crawler, import

**Черновик справочника** (Reference Draft):
The changes a Ежедневная проверка proposes to the Справочник. Only the owner sees it until they
publish it.
_Avoid_: Release, update, import, pull request
