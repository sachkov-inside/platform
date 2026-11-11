import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "kysely";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import { AppModule } from "../../src/app.module.js";
import type { ApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import {
  TELEGRAM_MESSAGES,
  type TelegramDeliveryResult,
  type TelegramWidgetAnswer,
} from "../../src/modules/outbound/telegram-messages.js";
import { TrainerBank } from "../../src/modules/trainer/trainer-bank.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { runTrainerReport } from "../../src/operations/trainer-report-command.js";
import { virtualTestClock } from "../support/fixed-clock.js";
import { closeIfStarted } from "../support/close-if-started.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { required } from "../support/required.js";
import {
  privateStartUpdate,
  widgetQueryUpdate,
} from "../support/synthetic-telegram-updates.js";
import {
  syntheticQuestion,
  syntheticTrainerBank,
  type SyntheticBank,
} from "../support/synthetic-trainer-bank.js";

registerFixedClock();

const databaseUrl = required(process.env["DATABASE_URL"]);
const WEBHOOK_SECRET = "synthetic_secret";

const config: ApplicationConfig = {
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
};

/** The bot's answers to widget presses; every send to Telegram succeeds. */
class RecordedAnswers {
  readonly answers: TelegramWidgetAnswer[] = [];
  private sent = 0;

  private delivered(): Promise<TelegramDeliveryResult> {
    this.sent += 1;
    return Promise.resolve({
      kind: "delivered",
      providerMessageId: String(7000 + this.sent),
    });
  }

  sendWidget = () => this.delivered();
  sendText = () => this.delivered();
  editText = () => this.delivered();

  answerWidgetQuery(answer: TelegramWidgetAnswer): Promise<void> {
    this.answers.push(answer);
    return Promise.resolve();
  }
}

const database: Database = createDatabase(databaseUrl);
const messages = new RecordedAnswers();
let application: NestFastifyApplication | undefined;
// The per-person request limit lives in process memory, so each case uses people of its own.
let nextUserId = 700_000;
let nextUpdateId = 1;
const newUser = () => (nextUserId += 1);

beforeAll(async () => {
  await migrateToLatest(database);
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(TELEGRAM_MESSAGES)
    .useValue(messages)
    .compile();
  application = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
});

beforeEach(async () => {
  await sql`
    truncate table
      trainer_issues,
      trainer_rounds,
      trainer_questions,
      trainer_topics,
      trainer_openings,
      bot_contact_events,
      bot_contacts,
      telegram_updates
    restart identity cascade
  `.execute(database);
  messages.answers.length = 0;
  await loadBank(oneQuestionPerTopic());
});

afterAll(async () => {
  try {
    if (application) await closeIfStarted(application);
  } finally {
    await database.destroy();
  }
});

/** Topics t1…t5 with one question each: a «Проверить себя» round asks all five. */
function oneQuestionPerTopic(): SyntheticBank {
  return syntheticTrainerBank({ topics: 5, questionsPerTopic: 1 });
}

/** The owner's import makes the stored Bank follow this synthetic file. */
async function loadBank(bank: SyntheticBank): Promise<void> {
  const report = await new TrainerBank(database, virtualTestClock).import(
    bank,
    true,
  );
  expect(report.status).toBe("imported");
}

/** Telegram delivers the update; the bot stores it and one worker pass handles it. */
async function receive(payload: unknown): Promise<void> {
  const bot = required(application);
  const response = await bot
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
  await bot.get(TelegramUpdateProcessor).processAvailable();
}

const at = (instant: string) => vi.setSystemTime(Date.parse(instant));

/** The person opens the Trainer: `/train`, or `/start train_<label>` from a link. */
const say = (userId: number, text: string) =>
  receive(privateStartUpdate((nextUpdateId += 1), userId, { text }));

/** A press that waits its turn: two seconds apart, a person stays under the request limit. */
async function tap(userId: number, data: string): Promise<readonly unknown[]> {
  // deterministic-test-allow wall-clock: reads the virtual Date registered by registerFixedClock.
  vi.setSystemTime(Date.now() + 2000);
  await receive(widgetQueryUpdate((nextUpdateId += 1), userId, data));
  const answer = messages.answers.at(-1);
  if (!answer) throw new Error(`The bot did not answer the press ${data}`);
  return z.array(z.unknown()).parse(JSON.parse(answer.data));
}

/**
 * Plays «Проверить себя» to the end. Option «А» is correct in a synthetic single-choice
 * question and option «Г» is wrong; `wrongTopic` names the topic answered wrongly.
 */
async function playRound(user: number, wrongTopic?: string): Promise<void> {
  let screen = await tap(user, "q");
  while (screen[0] === "q") {
    const [, issueId, topicName] = screen;
    const pick = topicName === wrongTopic ? 8 : 1;
    const explanation = await tap(user, `a${String(issueId)}:${String(pick)}`);
    expect(explanation[0]).toBe("e");
    screen = await tap(user, "n");
  }
}

/** Completes the one-question synthetic topic round. */
async function answerOneQuestion(user: number): Promise<void> {
  const [kind, issueId] = await tap(user, "tt1");
  expect(kind).toBe("q");
  expect((await tap(user, `a${String(issueId)}:1`))[0]).toBe("e");
}

/** Runs the owner's command and reads its JSON lines. */
async function report(mode: string): Promise<{
  lines: unknown[];
  stdout: string;
}> {
  const outcome = await runTrainerReport({ mode, database });
  expect(outcome.stderr).toBe("");
  expect(outcome.exitCode).toBe(0);
  return {
    stdout: outcome.stdout,
    lines: outcome.stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as unknown),
  };
}

describe("the questions report", () => {
  it("names every question with its topic, the number of answers and the share of correct ones", async () => {
    const [first, second, third] = [newUser(), newUser(), newUser()];
    await playRound(first);
    await playRound(second, "Синтетическая тема 1");
    await playRound(third, "Синтетическая тема 1");

    const { lines } = await report("--questions");

    const answered = {
      answers: 3,
      correct: 3,
      correctShare: 1,
      likes: 0,
      dislikes: 0,
    };
    expect(lines).toEqual([
      {
        question: "q-t1-1",
        topic: "t1",
        topicName: "Синтетическая тема 1",
        withdrawn: false,
        answers: 3,
        correct: 1,
        correctShare: 0.33,
        likes: 0,
        dislikes: 0,
      },
      ...[2, 3, 4, 5].map((topic) => ({
        question: `q-t${String(topic)}-1`,
        topic: `t${String(topic)}`,
        topicName: `Синтетическая тема ${String(topic)}`,
        withdrawn: false,
        ...answered,
      })),
    ]);
  });

  it("marks a withdrawn question, keeps its answers and lists a question nobody answered", async () => {
    await playRound(newUser());
    // The next file drops topic t5 with its question and adds a second question to t1.
    const next = syntheticTrainerBank({ topics: 4, questionsPerTopic: 1 });
    next.questions.push(syntheticQuestion("t1", 2));
    await loadBank(next);

    const { lines } = await report("--questions");

    expect(lines).toHaveLength(6);
    expect(lines[1]).toEqual({
      question: "q-t1-2",
      topic: "t1",
      topicName: "Синтетическая тема 1",
      withdrawn: false,
      answers: 0,
      correct: 0,
      correctShare: null,
      likes: 0,
      dislikes: 0,
    });
    expect(lines[5]).toEqual({
      question: "q-t5-1",
      topic: "t5",
      topicName: "Синтетическая тема 5",
      withdrawn: true,
      answers: 1,
      correct: 1,
      correctShare: 1,
      likes: 0,
      dislikes: 0,
    });
  });

  it("leaves every answer of an unfinished round out of the reports", async () => {
    const user = newUser();
    const [, issueId] = await tap(user, "q");
    await tap(user, `a${String(issueId)}:0`);
    // The second question is shown and stays without an answer.
    await tap(user, "n");

    const { lines } = await report("--questions");

    expect(
      z
        .array(z.object({ answers: z.number(), correct: z.number() }))
        .parse(lines)
        .map(({ answers, correct }) => [answers, correct])
        .sort(),
    ).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });
});

describe("the usage report", () => {
  it("counts openings, people and answerers of a day, split by source label", async () => {
    const [first, second, third] = [newUser(), newUser(), newUser()];
    await say(first, "/start train_post1");
    await answerOneQuestion(first);
    await say(second, "/start train_post1");
    await say(third, "/train");
    await answerOneQuestion(third);
    // The first person comes again the same day, now without a label.
    await say(first, "Тренажёр");

    const { lines } = await report("--usage");

    // The fixed test instant is 12:00 of 7 October in Moscow.
    expect(lines).toEqual([
      {
        day: "2026-10-07",
        openings: 4,
        people: 3,
        answered: 2,
        sources: [
          { source: "post1", openings: 2, people: 2, answered: 1 },
          { source: "неизвестна", openings: 2, people: 2, answered: 2 },
        ],
      },
    ]);
  });

  it("puts an opening and an answer on their Moscow days", async () => {
    const user = newUser();
    // 23:59:50 of 7 October in Moscow.
    at("2026-10-07T20:59:50Z");
    await say(user, "/start train_night");
    // 00:00:10 of 8 October in Moscow; the answer follows a few seconds later.
    at("2026-10-07T21:00:10Z");
    await answerOneQuestion(user);

    const { lines } = await report("--usage");

    expect(lines).toEqual([
      {
        day: "2026-10-07",
        openings: 1,
        people: 1,
        answered: 0,
        sources: [{ source: "night", openings: 1, people: 1, answered: 0 }],
      },
      { day: "2026-10-08", openings: 0, people: 0, answered: 1, sources: [] },
    ]);
  });
});

describe("both reports", () => {
  it("carry no Telegram identifier of the people they count", async () => {
    const [first, second] = [newUser(), newUser()];
    await say(first, "/start train_post1");
    await playRound(first);
    await say(second, "/train");
    await answerOneQuestion(second);

    const questions = await report("--questions");
    const usage = await report("--usage");

    expect(questions.lines).toHaveLength(5);
    expect(usage.lines).toHaveLength(1);
    for (const user of [first, second])
      expect(questions.stdout + usage.stdout).not.toContain(String(user));
  });

  it("refuse a call without a known report and print nothing", async () => {
    for (const mode of [undefined, "--people"])
      expect(await runTrainerReport({ mode, database })).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "Use --questions or --usage with DATABASE_URL.\n",
      });
  });
});
