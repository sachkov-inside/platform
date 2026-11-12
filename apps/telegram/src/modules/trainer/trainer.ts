import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type Database } from "../../database/database.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";
import { unhandled } from "../../shared/unhandled.js";
import { enqueueReply } from "../outbound/start-response-delivery-queue.js";
import {
  TELEGRAM_MESSAGES,
  type TelegramMessages,
} from "../outbound/telegram-messages.js";
import { TELEGRAM_WIDGET_TOO_OFTEN_TEXT } from "../outbound/telegram-widget-limits.js";
import { TrainerDaily } from "./trainer-daily.js";
import { trainerPointsOfRound } from "./trainer-points.js";
import {
  progressScreen,
  trainerAnswersToday,
  trainerProgress,
  trainerStreakDays,
} from "./trainer-progress.js";
import { TrainerRating } from "./trainer-rating.js";
import { TrainerReactions } from "./trainer-reactions.js";
import type { TrainerOpening, TrainerQuery } from "./trainer-requests.js";
import {
  TrainerRounds,
  type TrainerAnswerOutcome,
  type TrainerIssuedQuestion,
  type TrainerNothingToAsk,
  type TrainerRoundResult,
  type TrainerQuestionVersionUnavailable,
} from "./trainer-rounds.js";
import {
  explanationScreen,
  questionScreen,
  resultScreen,
} from "./trainer-screens.js";
import type { TrainerOpeningDelivery } from "./trainer-storage.js";
import { TrainerTopics, topicsScreen } from "./trainer-topics.js";
import { TRAINER_WIDGET_HTML } from "./widget/trainer-widget-html.generated.js";
import {
  encodeTrainerWidgetData,
  isFirstTrainerWidget,
  parseTrainerWidgetRequest,
  type OptionMask,
  type TrainerHomeData,
  type TrainerWidgetData,
  type TrainerWidgetRequest,
} from "./widget/trainer-widget-wire.js";

/** Answers in one Moscow day that complete the Daily goal. The goal only shows; it blocks nothing. */
const TRAINER_DAILY_GOAL = 5;
/** Questions in a round of «Проверить себя». */
const TRAINER_CHECK_QUESTIONS = 5;
/** The most questions in a round of «Тренировка по теме». */
const TRAINER_TOPIC_QUESTIONS = 10;

const WIDGET_REJECTED_TEXT =
  "Тренажёр не открылся. Обновите Telegram до последней версии и отправьте /train ещё раз.";
/** The answer names a question this person was not shown, or options the question lacks. */
const ISSUE_CLOSED_TEXT = "Этот вопрос уже закрыт. Начните новый раунд.";
const NO_QUESTIONS_TEXT = "Вопросы скоро появятся.";
const DAILY_WITHDRAWN_TEXT =
  "Сегодняшний Вопрос дня снят. Новый появится завтра.";
const ALL_ANSWERED_TEXT =
  "Вы верно ответили на все вопросы. Они вернутся через 30 дней после ответа.";
/** A widget message sent before contexts and explanation parts cannot show the question. */
const WIDGET_UPDATED_TEXT =
  "Тренажёр обновился. Отправьте /train, чтобы открыть новую версию.";

/** How a question is shown to the widget that asked for it. */
interface TrainerView {
  /** The widget message was sent before contexts and explanation parts. */
  readonly firstWidget: boolean;
  /** The person has read the context and asks for the question itself. */
  readonly contextRead: boolean;
}

/**
 * The Trainer of the private chat. It acts only inside a person's own request: `open` sends
 * the widget message and `answer` answers a press inside it. Nothing here runs on a schedule.
 */
@Injectable()
export class Trainer {
  private readonly rounds: TrainerRounds;
  private readonly daily: TrainerDaily;
  private readonly topics: TrainerTopics;
  private readonly rating: TrainerRating;
  private readonly reactions: TrainerReactions;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(TELEGRAM_MESSAGES)
    private readonly messages: Pick<
      TelegramMessages,
      "sendWidget" | "answerWidgetQuery"
    >,
  ) {
    this.rounds = new TrainerRounds(database);
    this.daily = new TrainerDaily(database);
    this.topics = new TrainerTopics(database);
    this.rating = new TrainerRating(database);
    this.reactions = new TrainerReactions(database);
  }

  /**
   * Records the opening and sends one widget message with the home screen. One request never
   * yields a second widget: a repeated run of the same update sends again only after Telegram
   * refused the earlier send for now. If Telegram rejects the widget, one text asks the person
   * to update Telegram.
   */
  async open(opening: TrainerOpening): Promise<void> {
    const { contact } = opening;
    if (!(await this.claim(opening))) return;
    await this.rating.observe(contact);

    const result = await this.messages.sendWidget({
      chatId: contact.privateChatId,
      html: TRAINER_WIDGET_HTML,
      chatData: encodeTrainerWidgetData(await this.home(contact)),
      height: 0,
    });
    switch (result.kind) {
      case "delivered":
        return this.settle(
          this.database,
          contact,
          "delivered",
          result.providerMessageId,
        );
      case "transport_unknown":
        // The widget may have arrived, so nothing more is sent; the person asks again if not.
        return this.settle(this.database, contact, "unknown");
      case "api_rejected":
        return this.database.transaction().execute(async (transaction) => {
          await this.settle(transaction, contact, "rejected");
          await enqueueReply(transaction, {
            botIdentity: contact.botIdentity,
            telegramUserId: contact.telegramUserId,
            privateChatId: contact.privateChatId,
            messageText: WIDGET_REJECTED_TEXT,
            sourceKey: `trainer-rejected:${contact.botIdentity}:${contact.updateId}`,
            triggerUpdateId: contact.updateId,
            now: contact.observedAt,
          });
        });
      case "api_retryable":
        await this.settle(this.database, contact, "retry");
        // The inbox runs the update again after its backoff.
        throw new Error(
          `Telegram refused the Trainer widget for now (${String(result.providerErrorCode)})`,
        );
      default:
        return unhandled(result, "Telegram delivery result");
    }
  }

  /** Answers a press inside the widget with the next screen; it never sends a message. */
  async answer(query: TrainerQuery): Promise<void> {
    const request = parseTrainerWidgetRequest(query.data);
    // The Rating shows the Telegram name of each person's last request, whatever it asked.
    await this.rating.observe(query.contact);
    await this.reply(
      query.queryId,
      request
        ? await this.respond(query.contact, request, {
            firstWidget: isFirstTrainerWidget(query.data),
            contextRead: request.kind === "question",
          })
        : ["x"],
    );
  }

  /** The answer to a press over the per-user request limit. */
  async refuse(queryId: string): Promise<void> {
    await this.reply(queryId, ["x", TELEGRAM_WIDGET_TOO_OFTEN_TEXT]);
  }

  /**
   * The screen a request leads to. The request is parsed but still untrusted: each mode checks
   * it against the bot's own state before it answers.
   */
  private async respond(
    contact: VerifiedPrivateStart,
    request: TrainerWidgetRequest,
    view: TrainerView,
  ): Promise<TrainerWidgetData> {
    // One case per request and no shared branches: each mode replaces its own lines.
    switch (request.kind) {
      case "home":
        return this.home(contact);
      case "start_check":
        return this.step(
          contact,
          await this.rounds.start(contact, {
            mode: "check",
            count: TRAINER_CHECK_QUESTIONS,
            updateId: contact.updateId,
            at: contact.observedAt,
          }),
          view,
        );
      case "answer": {
        const outcome = await this.rounds.answer(
          contact,
          request.issueId,
          request.optionMask,
          contact.observedAt,
        );
        return this.explanation(contact, outcome, 0);
      }
      case "explanation_part":
        // The request records nothing: it reads the stored answer.
        return this.explanation(
          contact,
          await this.rounds.storedAnswer(
            contact,
            request.issueId,
            contact.observedAt,
          ),
          request.part,
        );
      case "question": {
        const shown = await this.rounds.shown(
          contact,
          request.issueId,
          contact.observedAt,
        );
        if (!shown) return ["x", ISSUE_CLOSED_TEXT];
        if (shown.mode === "daily") {
          // Today's Daily question is shown for review once answered; its mode knows that.
          if (shown.today) return this.dailyQuestion(contact, view);
        } else if (
          shown.step.kind === "question" &&
          shown.step.issueId === request.issueId
        )
          return this.step(contact, shown.step, view);
        // The round has moved on, or the Daily question is of an earlier day. An answered
        // issue shows its explanation. An issue without an answer left the Bank while the
        // person read its context: the round goes on, the context of the next question first.
        const answer = await this.rounds.storedAnswer(
          contact,
          request.issueId,
          contact.observedAt,
        );
        if (answer) return this.explanation(contact, answer, 0);
        return shown.mode === "daily"
          ? ["x", ISSUE_CLOSED_TEXT]
          : this.step(contact, shown.step, { ...view, contextRead: false });
      }
      case "context": {
        const context = await this.rounds.contextOf(contact, request.issueId);
        return context === undefined
          ? ["x", ISSUE_CLOSED_TEXT]
          : ["c", request.issueId, context];
      }
      case "next": {
        const step = await this.rounds.next(
          contact,
          contact.observedAt,
          request.issueId,
        );
        return step ? this.step(contact, step, view) : this.home(contact);
      }
      case "start_daily":
        return this.dailyQuestion(contact, view);
      case "topics":
        return topicsScreen(await this.topics.list(contact), request.page);
      case "start_topic": {
        const topics = await this.topics.list(contact);
        // The code is the widget's word. A topic the Bank does not show starts no round: the
        // person gets the current list instead.
        if (!topics.some((topic) => topic.code === request.topicCode))
          return topicsScreen(topics);
        return this.step(
          contact,
          await this.rounds.start(contact, {
            mode: "topic",
            topicCode: request.topicCode,
            count: TRAINER_TOPIC_QUESTIONS,
            updateId: contact.updateId,
            at: contact.observedAt,
          }),
          view,
        );
      }
      case "progress":
        return progressScreen(
          await trainerProgress(this.database, contact, contact.observedAt),
          request.page,
        );
      case "rating":
        return this.rating.screen(contact, request.allTime);
      case "reaction": {
        const reaction = await this.reactions.set(
          contact,
          request.issueId,
          request.reaction,
        );
        return reaction === undefined
          ? ["x", ISSUE_CLOSED_TEXT]
          : ["u", request.issueId, reaction];
      }
      default:
        return unhandled(request, "Trainer widget request");
    }
  }

  /** Today's Daily question: to answer, or to review when the person has answered it. */
  private async dailyQuestion(
    contact: VerifiedPrivateStart,
    view: TrainerView,
  ): Promise<TrainerWidgetData> {
    const step = await this.daily.open(contact, {
      updateId: contact.updateId,
      at: contact.observedAt,
    });
    if (step.kind === "review")
      return this.question(step.question, view, step.pickedMask);
    if (step.kind === "withdrawn") return ["i", DAILY_WITHDRAWN_TEXT];
    return this.step(contact, step, view);
  }

  /**
   * A question as its widget can show it: the context first, the question once the person has
   * read it. A widget message sent before contexts gets a request to open the Trainer again
   * when the question does not fit it.
   */
  private question(
    question: TrainerIssuedQuestion,
    view: TrainerView,
    reviewMask?: OptionMask,
  ): TrainerWidgetData {
    if (view.firstWidget && !question.fitsFirstWidget)
      return ["i", WIDGET_UPDATED_TEXT];
    return question.context !== null && !view.contextRead
      ? ["c", question.issueId, question.context]
      : questionScreen(question, reviewMask);
  }

  /** One part of the explanation of a stored answer; a refusal when there is none. */
  private async explanation(
    contact: VerifiedPrivateStart,
    outcome: TrainerAnswerOutcome | undefined,
    part: number,
  ): Promise<TrainerWidgetData> {
    return (
      (outcome &&
        explanationScreen(
          outcome,
          await this.daily.statLine(outcome),
          await this.reactions.of(contact, outcome.questionId),
          part,
        )) ?? ["x", ISSUE_CLOSED_TEXT]
    );
  }

  /** The screen of a round step: a question, the result, or why there is nothing to ask. */
  private async step(
    contact: VerifiedPrivateStart,
    step:
      | TrainerIssuedQuestion
      | TrainerRoundResult
      | TrainerNothingToAsk
      | TrainerQuestionVersionUnavailable,
    view: TrainerView,
  ): Promise<TrainerWidgetData> {
    switch (step.kind) {
      case "version_unavailable":
        return [
          "i",
          "Прежняя редакция вопроса недоступна. Ответы и очки сохранены.",
        ];
      case "question":
        return this.question(step, view);
      case "result": {
        // The result of a topic round is titled with the topic's name from the Bank.
        const { topicCode } = step.round;
        return resultScreen(
          step,
          {
            points: await trainerPointsOfRound(
              this.database,
              contact,
              step.round.id,
            ),
            streakDays: await trainerStreakDays(
              this.database,
              contact,
              contact.observedAt,
            ),
            weekPlace: await this.rating.weekPlace(contact, contact.observedAt),
          },
          topicCode === null ? undefined : await this.topics.name(topicCode),
        );
      }
      case "nothing":
        return [
          "i",
          step.reason === "no_questions"
            ? NO_QUESTIONS_TEXT
            : ALL_ANSWERED_TEXT,
        ];
      default:
        return unhandled(step, "Trainer round step");
    }
  }

  /**
   * The home screen: the person's Series, today's answers out of the Daily goal and whether
   * today's Daily question is answered. Answers above the goal are accepted and leave it
   * complete.
   */
  private async home(contact: VerifiedPrivateStart): Promise<TrainerHomeData> {
    // The moment of every count is the moment the bot received this request.
    const at = contact.observedAt;
    return [
      "h",
      await trainerStreakDays(this.database, contact, at),
      Math.min(
        await trainerAnswersToday(this.database, contact, at),
        TRAINER_DAILY_GOAL,
      ),
      TRAINER_DAILY_GOAL,
      (await this.daily.answered(contact, at)) ? 1 : 0,
    ];
  }

  private reply(queryId: string, data: TrainerWidgetData): Promise<void> {
    return this.messages.answerWidgetQuery({
      queryId,
      data: encodeTrainerWidgetData(data),
    });
  }

  /** True when this run of the update is the one that sends the widget. */
  private async claim(opening: TrainerOpening): Promise<boolean> {
    const { contact } = opening;
    const recorded = await this.database
      .insertInto("trainer_openings")
      .values({
        opening_id: randomUUID(),
        bot_identity: contact.botIdentity,
        update_id: contact.updateId,
        telegram_user_id: contact.telegramUserId,
        entry: opening.entry,
        source_code: opening.source ?? null,
        opened_at: contact.observedAt,
        delivery: "sending",
        provider_message_id: null,
      })
      .onConflict((conflict) =>
        conflict.columns(["bot_identity", "update_id"]).doNothing(),
      )
      .returning("opening_id")
      .executeTakeFirst();
    if (recorded) return true;
    const retried = await this.database
      .updateTable("trainer_openings")
      .set({ delivery: "sending" })
      .where("bot_identity", "=", contact.botIdentity)
      .where("update_id", "=", contact.updateId)
      .where("delivery", "=", "retry")
      .returning("opening_id")
      .executeTakeFirst();
    return retried !== undefined;
  }

  private async settle(
    database: Pick<Database, "updateTable">,
    contact: VerifiedPrivateStart,
    delivery: TrainerOpeningDelivery,
    providerMessageId?: string,
  ): Promise<void> {
    await database
      .updateTable("trainer_openings")
      .set({ delivery, provider_message_id: providerMessageId ?? null })
      .where("bot_identity", "=", contact.botIdentity)
      .where("update_id", "=", contact.updateId)
      .execute();
  }
}
