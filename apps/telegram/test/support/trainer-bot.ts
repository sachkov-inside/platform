import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "kysely";
import { expect, vi } from "vitest";
import { z } from "zod";

import { AppModule } from "../../src/app.module.js";
import type { ApplicationConfig } from "../../src/config/application-config.js";
import type { Database } from "../../src/database/database.js";
import {
  TELEGRAM_MESSAGES,
  type TelegramDeliveryResult,
  type TelegramMessages,
  type TelegramTextMessage,
  type TelegramWidgetAnswer,
  type TelegramWidgetMessage,
} from "../../src/modules/outbound/telegram-messages.js";
import { TELEGRAM_CALLBACK_ANSWERS } from "../../src/modules/bot-sign-in/telegram-callback-answers.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { virtualTestClock } from "./fixed-clock.js";
import {
  privateStartUpdate,
  widgetQueryUpdate,
} from "./synthetic-telegram-updates.js";
import {
  syntheticQuestion,
  syntheticTrainerBank,
  type SyntheticBank,
} from "./synthetic-trainer-bank.js";

// The whole bot with the Trainer and ИИ-модели for a test file of its own: synthetic Telegram
// updates go in through the webhook, and the test reads what the bot handed to Telegram. The
// file that uses it registers the fixed clock and owns the database connection.

const WEBHOOK_SECRET = "synthetic_secret";

const config = (databaseUrl: string): ApplicationConfig => ({
  marketingEnabled: false,
  botIdentity: "inside",
  canonicalChatId: "-1000000000000",
  databaseUrl,
  deliveryMode: "disabled",
  evidenceDeliveryMode: "disabled",
  host: "127.0.0.1",
  linkReceiptText: "Synthetic link receipt",
  linkedMemberText: "Synthetic member status",
  linkedNonMemberText: "Synthetic non-member status",
  linkedUnavailableText: "Synthetic unavailable status",
  communityMode: "disabled",
  communityReconciliationCadenceMilliseconds: 60_000,
  communityTexts: {
    invite: "Synthetic community invite",
    preparing: "Synthetic community preparing",
    member: "Synthetic community member",
    unavailable: "Synthetic community unavailable",
    readmission: "Synthetic community readmission",
    welcome: "Synthetic community welcome",
  },
  membershipMode: "disabled",
  membershipCheckRetentionDays: 90,
  salesFunnelEventRetentionDays: 30,
  membershipReconciliationCadenceMilliseconds: 240_000,
  platformIntegrationSecret: "synthetic_platform_secret",
  port: 3002,
  webhookSecret: WEBHOOK_SECRET,
  welcomeText: "Synthetic welcome",
  workersEnabled: false,
});

/** Everything the bot hands to Telegram through the outbound message port. */
class RecordedMessages implements TelegramMessages {
  readonly widgets: TelegramWidgetMessage[] = [];
  readonly answers: TelegramWidgetAnswer[] = [];
  readonly texts: TelegramTextMessage[] = [];
  /** Results of the next widget sends; a send beyond the list is delivered. */
  readonly widgetResults: (TelegramDeliveryResult | Error)[] = [];
  /** Presses of inline buttons the bot acknowledged, by callback query id. */
  readonly callbackAnswers: string[] = [];

  sendWidget(message: TelegramWidgetMessage): Promise<TelegramDeliveryResult> {
    this.widgets.push(message);
    const result = this.widgetResults.shift();
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(
      result ?? {
        kind: "delivered",
        providerMessageId: String(7000 + this.widgets.length),
      },
    );
  }

  answerWidgetQuery(answer: TelegramWidgetAnswer): Promise<void> {
    this.answers.push(answer);
    return Promise.resolve();
  }

  sendText(message: TelegramTextMessage): Promise<TelegramDeliveryResult> {
    this.texts.push(message);
    return Promise.resolve({
      kind: "delivered",
      providerMessageId: String(8000 + this.texts.length),
    });
  }

  editText(): Promise<TelegramDeliveryResult> {
    return Promise.reject(new Error("Unexpected message edit"));
  }

  reset(): void {
    this.widgets.length = 0;
    this.answers.length = 0;
    this.texts.length = 0;
    this.widgetResults.length = 0;
    this.callbackAnswers.length = 0;
  }
}

export type TrainerScreen = readonly unknown[];

export interface AskedQuestion {
  readonly issueId: string;
  /** Identifier in the synthetic Bank, e.g. `q-t2-3`. */
  readonly questionId: string;
  readonly topicCode: string;
  /** The synthetic Bank marks the first option correct, or the first two when several are. */
  readonly correctMask: 1 | 3;
}

/** Reads a question screen of the synthetic Bank. */
export function asked(screen: TrainerScreen): AskedQuestion {
  const [kind, issueId, , text] = screen;
  const question = /^Синтетический вопрос (\d+) темы (t\d+)$/.exec(
    String(text),
  );
  if (kind !== "q" || !question || typeof issueId !== "string")
    throw new Error(`Not a synthetic question: ${JSON.stringify(screen)}`);
  return {
    issueId,
    questionId: `q-${String(question[2])}-${String(question[1])}`,
    topicCode: String(question[2]),
    // Every third question of a synthetic topic has several correct options.
    correctMask: Number(question[1]) % 3 === 0 ? 3 : 1,
  };
}

export const right = (question: AskedQuestion) =>
  `a${question.issueId}:${String(question.correctMask)}`;
/** Option «Г» alone is wrong in every synthetic question. */
export const wrong = (question: AskedQuestion) => `a${question.issueId}:8`;
export const dontKnow = (question: AskedQuestion) => `a${question.issueId}:0`;

/** Topics t1…tN, each with the synthetic questions of these numbers; number 3 has two correct options. */
export function bankOf(numbers: readonly number[], topics = 5): SyntheticBank {
  const bank = syntheticTrainerBank({ topics, questionsPerTopic: 0 });
  bank.questions = bank.topics.flatMap(({ code }) =>
    numbers.map((number) =>
      syntheticQuestion(code, number, number % 3 === 0 ? "multiple" : "single"),
    ),
  );
  return bank;
}

/** The owner's import makes the stored Bank follow this synthetic file. */
export async function loadBank(
  database: Database,
  bank: SyntheticBank,
): Promise<void> {
  const report = await new TrainerBank(database, virtualTestClock).import(
    bank,
    true,
  );
  expect(report.status).toBe("imported");
}

/** Empties everything a Trainer case writes. */
export async function clearTrainerData(database: Database): Promise<void> {
  await sql`
    truncate table
      trainer_rating_consents,
      trainer_rating_profiles,
      trainer_question_reactions,
      trainer_issues,
      trainer_rounds,
      trainer_questions,
      trainer_topics,
      trainer_openings,
      start_response_delivery_attempts,
      start_response_deliveries,
      bot_contact_events,
      bot_contacts,
      telegram_updates
    restart identity cascade
  `.execute(database);
}

// The per-user rate limit lives in process memory, so each case uses people of its own.
let nextUserId = 1_999_000;
let nextUpdateId = 1_999_000_000;
export const newUser = () => (nextUserId += 1);
/** A Telegram update id no other update of the test run has. */
export const newUpdateId = () => (nextUpdateId += 1);

export interface TrainerBot {
  readonly application: NestFastifyApplication;
  readonly messages: RecordedMessages;
  /** Telegram delivers this update; the bot stores it and one worker pass handles it. */
  readonly receive: (payload: unknown) => Promise<void>;
  /** The person sends a text to the bot. */
  readonly say: (userId: number, text: string) => Promise<void>;
  /**
   * A press inside the widget, two seconds after the previous request: at that pace a person
   * stays under the request limit. Returns the screen the bot answered with.
   */
  readonly tap: (userId: number, data: string) => Promise<TrainerScreen>;
  /** From now on the person's presses carry this Telegram name; "Synthetic" before that. */
  readonly rename: (
    userId: number,
    firstName: string,
    lastName?: string,
  ) => void;
  /** Starts «Проверить себя» and answers every question the way `answer` chooses. */
  readonly playRound: (
    userId: number,
    answer?: (question: AskedQuestion, step: number) => string,
  ) => Promise<TrainerScreen>;
}

export async function startTrainerBot(
  databaseUrl: string,
): Promise<TrainerBot> {
  const messages = new RecordedMessages();
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config(databaseUrl))],
  })
    .overrideProvider(TELEGRAM_MESSAGES)
    .useValue(messages)
    .overrideProvider(TELEGRAM_CALLBACK_ANSWERS)
    .useValue({
      answer: (id: string) => {
        messages.callbackAnswers.push(id);
        return Promise.resolve();
      },
    })
    .compile();
  const application = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await application.init();
  await application.getHttpAdapter().getInstance().ready();

  /** Telegram delivers the update; the bot stores it and one worker pass handles it. */
  const receive = async (payload: unknown): Promise<void> => {
    const response = await application
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
        },
        method: "POST",
        payload: JSON.stringify(payload),
        url: "/webhooks/telegram",
      });
    expect(response.statusCode).toBe(202);
    await application.get(TelegramUpdateProcessor).processAvailable();
  };
  const names = new Map<number, { firstName: string; lastName?: string }>();
  const tap = async (userId: number, data: string): Promise<TrainerScreen> => {
    // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
    vi.setSystemTime(Date.now() + 2000);
    const answersBefore = messages.answers.length;
    await receive(
      widgetQueryUpdate(newUpdateId(), userId, data, names.get(userId)),
    );
    const answer = messages.answers.at(answersBefore);
    if (!answer) throw new Error(`The bot did not answer the press ${data}`);
    return z.array(z.unknown()).parse(JSON.parse(answer.data));
  };

  return {
    application,
    messages,
    receive,
    say: (userId, text) =>
      receive(privateStartUpdate(newUpdateId(), userId, { text })),
    tap,
    rename: (userId, firstName, lastName) => {
      names.set(userId, {
        firstName,
        ...(lastName === undefined ? {} : { lastName }),
      });
    },
    playRound: async (userId, answer = right) => {
      let step = 0;
      let screen = await tap(userId, "q");
      while (screen[0] === "q") {
        const explanation = await tap(
          userId,
          answer(asked(screen), (step += 1)),
        );
        expect(explanation[0]).toBe("e");
        screen = await tap(userId, "n");
      }
      return screen;
    },
  };
}
