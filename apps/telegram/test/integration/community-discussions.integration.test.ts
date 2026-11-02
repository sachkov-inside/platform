import {
  CommunityDiscussionBudget,
  BudgetedDiscussionModel,
} from "../../src/modules/community-discussions/community-discussion-budget.js";
import {
  communityDiscussionsSuccessSchema,
  type CommunityDiscussionsRequest,
  type CommunityDiscussionsSuccess,
} from "@inside/contracts/community-discussions";
import { COMMUNITY_FILES } from "../../src/modules/community-discussions/community-files.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { purgeExpiredRecords } from "../../src/database/retention.js";
import { seedCommunityBinding } from "../support/community-binding.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { sql } from "kysely";
import { AppModule } from "../../src/app.module.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { CommunityMessages } from "../../src/modules/community-discussions/community-messages.js";
import { CommunityDiscussionProcessor } from "../../src/modules/community-discussions/community-discussion-processor.js";
import {
  COMMUNITY_DISCUSSION_MODEL,
  type CommunityDiscussionModel,
  type GroupInput,
  type GroupResult,
} from "../../src/modules/community-discussions/discussion-model.js";
import { AUTHOR_AUTHORIZATION } from "../../src/modules/communications/author-authorization.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { required } from "../support/required.js";

registerFixedClock();
const now = new Date(fixedTestInstant());
const database = createDatabase(required(process.env["DATABASE_URL"]));
let app: NestFastifyApplication | undefined;
const secret = "synthetic_discussions_secret_for_tests_only";
const actor = { accountRef: "synthetic-author" };
const version = "inside.community-discussions.v1";
let permission: "allowed" | "denied" | "unavailable" = "allowed";
const inputs: GroupInput[] = [];
let transcriptions = 0;
let downloads = 0;
let transcriptionFailure = false;
let result: GroupResult;
let failure: Error | undefined;
let authorize:
  (() => Promise<"allowed" | "denied" | "unavailable">) | undefined;
let respond: ((input: GroupInput) => Promise<GroupResult>) | undefined;
const model: CommunityDiscussionModel = {
  group: (input) => {
    inputs.push(input);
    return respond
      ? respond(input)
      : failure
        ? Promise.reject(failure)
        : Promise.resolve(result);
  },
  transcribe: () => {
    transcriptions++;
    return transcriptionFailure
      ? Promise.reject(new Error("synthetic transcription failure"))
      : Promise.resolve({
          text: "Сначала определите задачу.",
          usage: { inputTokens: null, outputTokens: null, durationSeconds: 23 },
        });
  },
};

beforeAll(async () => {
  await migrateToLatest(database);
});
beforeEach(async () => {
  await sql`truncate community_discussion_model_calls, community_discussion_budget_months, community_discussion_runs, community_discussion_mark_receipts, community_discussion_sources, community_discussions, community_discussion_schedule, community_messages, telegram_updates, bot_contacts, start_response_deliveries, platform_links, link_transactions restart identity cascade`.execute(
    database,
  );
  transcriptions = 0;
  downloads = 0;
  transcriptionFailure = false;
  permission = "allowed";
  inputs.length = 0;
  failure = undefined;
  respond = undefined;
  authorize = undefined;
  result = {
    discussions: [
      {
        discussionId: null,
        messageIds: ["10", "11"],
        question: "Как выбрать инструмент?",
        answers: "Сначала определите задачу.",
        conclusion: "Выбор зависит от задачи.",
        answered: true,
      },
    ],
    usage: { inputTokens: 100, outputTokens: 50 },
  };
  await start();
});
async function start(grouping = true, limit = "1000000", budgeted = false) {
  const config = loadApplicationConfig({
    DATABASE_URL: required(process.env["DATABASE_URL"]),
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
    TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
    COMMUNITY_DISCUSSIONS_MONTHLY_LIMIT_MICRO_USD: limit,
    PLATFORM_COMMUNITY_DISCUSSIONS_SECRET: secret,
    ...(grouping
      ? {
          COMMUNITY_DISCUSSIONS_MODEL_BASE_URL: "http://127.0.0.1:19999/v1",
          COMMUNITY_DISCUSSIONS_MODEL_API_KEY: "synthetic",
          COMMUNITY_DISCUSSIONS_MODEL: "synthetic-model",
          COMMUNITY_DISCUSSIONS_TRANSCRIPTION_BASE_URL:
            "http://127.0.0.1:19998/v1",
          COMMUNITY_DISCUSSIONS_TRANSCRIPTION_API_KEY: "synthetic-audio",
          COMMUNITY_DISCUSSIONS_TRANSCRIPTION_MODEL:
            "synthetic-transcription-model",
        }
      : {}),
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic non member",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
    WORKERS_ENABLED: "false",
  });
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(COMMUNITY_FILES)
    .useValue({
      download: () => {
        downloads++;
        return Promise.resolve(Buffer.from("OggSsynthetic"));
      },
    })
    .overrideProvider(COMMUNITY_DISCUSSION_MODEL)
    .useFactory({
      inject: [CommunityDiscussionBudget],
      factory: (budget: CommunityDiscussionBudget) =>
        budgeted ? new BudgetedDiscussionModel(model, budget) : model,
    })
    .overrideProvider(AUTHOR_AUTHORIZATION)
    .useValue({
      authorize: () => (authorize ? authorize() : Promise.resolve(permission)),
    })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(async () => {
  await database.destroy();
});
function application() {
  return required(app);
}
async function capture(
  messageId: string,
  text: string,
  sender = "42",
  sentAt = now,
) {
  await application()
    .get(CommunityMessages)
    .capture({
      botIdentity: "inside",
      chatId: "-1000000000000",
      updateId: messageId,
      messageId,
      threadId: "7",
      replyToMessageId: ["11", "12"].includes(messageId) ? "10" : null,
      sentAt,
      editedAt: null,
      senderTelegramUserId: sender,
      kind: "text",
      text,
      fileId: null,
    });
}
type ApiResponse<Operation extends CommunityDiscussionsRequest["operation"]> = {
  statusCode: number;
  json: () => Extract<CommunityDiscussionsSuccess, { operation: Operation }>;
};
function api(
  operation: "discussions.list",
  fields?: Record<string, unknown>,
  authorization?: string,
): Promise<ApiResponse<"discussions.list">>;
function api(
  operation: "discussions.read",
  fields?: Record<string, unknown>,
  authorization?: string,
): Promise<ApiResponse<"discussions.read">>;
function api(
  operation: "discussions.mark",
  fields?: Record<string, unknown>,
  authorization?: string,
): Promise<ApiResponse<"discussions.mark">>;
async function api(
  operation: CommunityDiscussionsRequest["operation"],
  fields: Record<string, unknown> = {},
  authorization: string | undefined = `Bearer ${secret}`,
) {
  const response = await application().inject({
    method: "POST",
    url: "/integrations/platform/v1/community-discussions",
    ...(authorization !== "" ? { headers: { authorization } } : {}),
    payload: {
      contractVersion: version,
      requestId: "synthetic-request",
      actor,
      operation,
      ...fields,
    },
  });
  return {
    statusCode: response.statusCode,
    json: () => {
      const body = communityDiscussionsSuccessSchema.parse(
        response.json<unknown>(),
      );
      if (body.operation !== operation)
        throw new Error("Unexpected response operation");
      return body;
    },
  };
}

describe("community discussion processing", () => {
  it("keeps capture active at zero budget and resumes on the next run after each cap increase", async () => {
    await application().close();
    app = undefined;
    await start(true, "0", true);
    await capture("10", "Вопрос?");
    await capture("11", "Ответ.");
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "budget_exceeded", messages: 0 });
    expect(inputs).toHaveLength(0);
    expect(
      (await application().get(CommunityMessages).readMessages({ limit: 10 }))
        .messages,
    ).toHaveLength(2);
    await application().close();
    app = undefined;
    await start(true, "10000", true);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "budget_exceeded", messages: 2, discussions: 1 });
    await capture("12", "Следующий вопрос?");
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "not_due" });
    await application().close();
    app = undefined;
    await start(true, "20000", true);
    result.discussions = [];
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "budget_exceeded", messages: 1 });
    expect(
      await application().get(CommunityDiscussionBudget).snapshot(),
    ).toMatchObject({
      monthCostMicroUsd: 20000,
      modelCalls: 2,
      lastRun: {
        messages: 1,
        transcriptions: 0,
        discussions: 0,
        errors: 0,
        skips: 1,
        status: "budget_exceeded",
      },
    });
    const metrics = await application().inject({
      method: "GET",
      url: "/metrics",
    });
    expect(metrics.body).toContain(
      "inside_telegram_community_discussions_month_cost_micro_usd 20000",
    );
    expect(metrics.body).toContain(
      "inside_telegram_community_discussions_last_run_messages 1",
    );
  });
  it("resumes a billed provider failure immediately after a cap increase and preserves its error count", async () => {
    await application().close();
    app = undefined;
    await start(true, "10000", true);
    await capture("10", "Вопрос?");
    await capture("11", "Ответ.");
    failure = new Error("synthetic billed failure");
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "budget_exceeded", messages: 0 });
    expect(
      await application().get(CommunityDiscussionBudget).snapshot(),
    ).toMatchObject({
      monthCostMicroUsd: 10000,
      lastRun: { errors: 1, skips: 1 },
    });
    await application().close();
    app = undefined;
    await start(true, "20000", true);
    failure = undefined;
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "budget_exceeded", messages: 2 });
  });
  it("charges an invalid grouping response and persists failed-run diagnostics before retrying", async () => {
    await application().close();
    app = undefined;
    await start(true, "100000", true);
    await capture("10", "Вопрос?");
    await capture("11", "Ответ.");
    result.discussions[0] = {
      ...required(result.discussions[0]),
      messageIds: ["unknown"],
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "failed", messages: 0 });
    expect(
      await application().get(CommunityDiscussionBudget).snapshot(),
    ).toMatchObject({
      monthCostMicroUsd: 10000,
      modelCalls: 1,
      lastRun: { status: "failed", errors: 1, skips: 0, messages: 0 },
    });
    vi.setSystemTime(now.getTime() + 300000);
    result.discussions[0] = {
      ...required(result.discussions[0]),
      messageIds: ["10", "11"],
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 2 });
    expect(
      await application().get(CommunityDiscussionBudget).snapshot(),
    ).toMatchObject({
      monthCostMicroUsd: 20000,
      modelCalls: 2,
      lastRun: { status: "completed", errors: 0, messages: 2 },
    });
  });
  it("stops transcription at the limit without downloading remaining audio and resumes before grouping", async () => {
    await application().close();
    app = undefined;
    await start(true, "10000", true);
    for (const messageId of ["10", "11"])
      await application()
        .get(CommunityMessages)
        .capture({
          botIdentity: "inside",
          chatId: "-1000000000000",
          updateId: messageId,
          messageId,
          threadId: null,
          replyToMessageId: null,
          sentAt: now,
          editedAt: null,
          senderTelegramUserId: "42",
          kind: "voice",
          text: "",
          fileId: `synthetic-${messageId}`,
          durationSeconds: 23,
        });
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({
      status: "budget_exceeded",
      transcriptions: 1,
      messages: 0,
    });
    expect(downloads).toBe(1);
    expect(inputs).toHaveLength(0);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "not_due" });
    expect(downloads).toBe(1);
    await application().close();
    app = undefined;
    await start(true, "30000", true);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({
      status: "budget_exceeded",
      transcriptions: 1,
      messages: 2,
    });
    expect(downloads).toBe(2);
    expect(
      await application().get(CommunityDiscussionBudget).snapshot(),
    ).toMatchObject({ monthCostMicroUsd: 30000, modelCalls: 3 });
  });
  it("transcribes voice and video notes before grouping and exposes cached transcripts through HTTP", async () => {
    for (const [id, kind] of [
      [10, "voice"],
      [11, "video_note"],
    ] as const) {
      await application().inject({
        method: "POST",
        url: "/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token":
            "synthetic_webhook_secret_for_tests_only",
        },
        payload: {
          update_id: id,
          message: {
            message_id: id,
            date: now.getTime() / 1000,
            chat: { id: -1000000000000, type: "supergroup" },
            from: { id: 42, is_bot: false },
            [kind]: { file_id: `synthetic-${id}`, duration: 23 },
          },
        },
      });
    }
    await application().get(TelegramUpdateProcessor).processAvailable(10, now);
    expect(downloads).toBe(0);
    expect(
      (await application().get(CommunityMessages).readMessages({ limit: 10 }))
        .messages,
    ).toMatchObject([
      { kind: "voice", fileId: "synthetic-10" },
      { kind: "video_note", fileId: "synthetic-11" },
    ]);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", transcriptions: 2 });
    expect(inputs[0]?.messages.map((message) => message.text)).toEqual([
      "Сначала определите задачу.",
      "Сначала определите задачу.",
    ]);
    const discussionId = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    ).discussionId;
    expect(
      (await api("discussions.read", { discussionId })).json().discussion
        .messages,
    ).toMatchObject([
      {
        transcript: "Сначала определите задачу.",
        transcriptionStatus: "completed",
      },
      { transcriptionStatus: "completed" },
    ]);
    vi.setSystemTime(now.getTime() + 86_400_000);
    await application().get(CommunityDiscussionProcessor).processDue();
    expect(transcriptions).toBe(2);
    expect(downloads).toBe(2);
    vi.setSystemTime(now.getTime() + 91 * 86_400_000);
    await purgeExpiredRecords(
      database,
      new Date(now.getTime() + 91 * 86_400_000),
      { membershipCheckDays: 30, salesFunnelEventDays: 30 },
    );
    expect(
      (await application().get(CommunityMessages).readMessages({ limit: 10 }))
        .messages,
    ).toEqual([]);
    expect(
      (await api("discussions.read", { discussionId })).json().discussion
        .messages,
    ).toMatchObject([
      { text: null, transcript: null, transcriptionStatus: "expired" },
      { transcriptionStatus: "expired" },
    ]);
  });
  it("marks a failed voice transcript and retries it while grouping other messages", async () => {
    await capture("10", "Как выбрать инструмент?");
    await application().get(CommunityMessages).capture({
      botIdentity: "inside",
      chatId: "-1000000000000",
      messageId: "11",
      updateId: "11",
      threadId: "7",
      replyToMessageId: "10",
      sentAt: now,
      editedAt: null,
      senderTelegramUserId: "43",
      kind: "voice",
      text: "",
      fileId: "synthetic-voice",
      durationSeconds: 23,
    });
    transcriptionFailure = true;
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({
      status: "completed",
      transcriptionErrors: 1,
      messages: 2,
    });
    const discussionId = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    ).discussionId;
    expect(
      (await api("discussions.read", { discussionId })).json().discussion
        .messages,
    ).toMatchObject([
      { transcriptionStatus: "not_applicable" },
      { transcript: null, transcriptionStatus: "pending" },
    ]);
    vi.setSystemTime(now.getTime() + 86_400_000);
    transcriptionFailure = false;
    result.discussions[0] = {
      ...required(result.discussions[0]),
      discussionId,
      messageIds: ["11"],
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", transcriptions: 1, messages: 1 });
    expect(
      (await api("discussions.read", { discussionId })).json().discussion
        .messages[1],
    ).toMatchObject({
      transcript: "Сначала определите задачу.",
      transcriptionStatus: "completed",
    });
    expect(transcriptions).toBe(2);
  });
  it("groups related captured messages once and returns their source links through HTTP", async () => {
    for (const [messageId, text, sender] of [
      [10, "Как выбрать инструмент?", 42],
      [11, "Сначала определите задачу.", 43],
    ] as const) {
      const response = await application().inject({
        method: "POST",
        url: "/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token":
            "synthetic_webhook_secret_for_tests_only",
        },
        payload: {
          update_id: messageId,
          message: {
            message_id: messageId,
            date: now.getTime() / 1000,
            chat: { id: -1000000000000, type: "supergroup" },
            from: {
              id: sender,
              is_bot: false,
              first_name: "Private synthetic name",
            },
            message_thread_id: 7,
            text,
            ...(messageId === 11
              ? { reply_to_message: { message_id: 10 } }
              : {}),
          },
        },
      });
      expect(response.statusCode).toBe(202);
    }
    await application().get(TelegramUpdateProcessor).processAvailable(10, now);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 2, discussions: 1 });
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "not_due" });
    const list = await api("discussions.list", { limit: 10 });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      status: "new",
      question: "Как выбрать инструмент?",
      answers: "Сначала определите задачу.",
      conclusion: "Выбор зависит от задачи.",
    });
    const read = await api("discussions.read", {
      discussionId: required(body.items[0]).discussionId,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().discussion.messages).toMatchObject([
      {
        messageId: "10",
        role: "участник 1",
        text: "Как выбрать инструмент?",
        sourceUrl: "https://t.me/c/0000000000/10",
      },
      {
        messageId: "11",
        role: "участник 2",
        text: "Сначала определите задачу.",
        sourceUrl: "https://t.me/c/0000000000/11",
      },
    ]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.messages.map(({ role }) => role)).toEqual([
      "участник 1",
      "участник 2",
    ]);
    expect(JSON.stringify(inputs)).not.toContain("senderTelegramUserId");
    expect(JSON.stringify(inputs)).not.toContain("Private synthetic name");
  });
  it("accepts a newer webhook edit after update ID reset and ignores stale revisions", async () => {
    const deliver = async (updateId: number, text: string, editedAt?: Date) => {
      const response = await application().inject({
        method: "POST",
        url: "/webhooks/telegram",
        headers: {
          "x-telegram-bot-api-secret-token":
            "synthetic_webhook_secret_for_tests_only",
        },
        payload: {
          update_id: updateId,
          [editedAt ? "edited_message" : "message"]: {
            message_id: 10,
            date: now.getTime() / 1000,
            ...(editedAt ? { edit_date: editedAt.getTime() / 1000 } : {}),
            message_thread_id: 7,
            chat: { id: -1000000000000, type: "supergroup" },
            from: { id: 42, is_bot: false },
            text,
          },
        },
      });
      expect(response.statusCode).toBe(202);
      await application()
        .get(TelegramUpdateProcessor)
        .processAvailable(10, required(vi.getMockedSystemTime()));
    };
    await deliver(10000, "Как выбрать инструмент?");
    await capture("11", "Сначала определите задачу.");
    await application().get(CommunityDiscussionProcessor).processDue();
    const initial = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    );
    const editTime = new Date(now.getTime() + 8 * 86400000);
    vi.setSystemTime(editTime);
    await deliver(1, "Уточнённый вопрос", editTime);
    result.discussions[0] = {
      ...required(result.discussions[0]),
      discussionId: initial.discussionId,
      messageIds: ["10"],
      question: "Уточнённый вопрос",
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1 });
    expect(
      inputs[1]?.discussions.map((discussion) => discussion.discussionId),
    ).toContain(initial.discussionId);
    expect(
      (
        await api("discussions.read", { discussionId: initial.discussionId })
      ).json().discussion,
    ).toMatchObject({
      question: "Уточнённый вопрос",
      messages: [
        { messageId: "10", text: "Уточнённый вопрос" },
        { messageId: "11" },
      ],
    });
    // Replay and delayed delivery must not clear the accepted processing mark.
    await deliver(1, "Duplicate payload", editTime);
    await deliver(
      10001,
      "Outdated question",
      new Date(editTime.getTime() - 1000),
    );
    vi.setSystemTime(editTime.getTime() + 86400000);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 0 });
    expect(inputs).toHaveLength(2);
    expect(
      (
        await api("discussions.read", { discussionId: initial.discussionId })
      ).json().discussion.messages[0]?.text,
    ).toBe("Уточнённый вопрос");
  });

  it("refreshes audio only for accepted edits and uses update IDs to order edits within one second", async () => {
    const messages = application().get(CommunityMessages);
    const voice = {
      botIdentity: "inside",
      chatId: "-1000000000000",
      messageId: "11",
      threadId: "7",
      replyToMessageId: "10",
      sentAt: now,
      senderTelegramUserId: "43",
      kind: "voice" as const,
      text: "",
      fileId: "first-audio",
    };
    await capture("10", "Как выбрать инструмент?");
    await messages.capture({ ...voice, updateId: "10000", editedAt: null });
    await application().get(CommunityDiscussionProcessor).processDue();
    const initial = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    );
    const editTime = new Date(now.getTime() + 8 * 86400000);
    vi.setSystemTime(editTime);
    await messages.capture({
      ...voice,
      fileId: "second-audio",
      updateId: "1",
      editedAt: editTime,
    });
    result.discussions[0] = {
      ...required(result.discussions[0]),
      discussionId: initial.discussionId,
      messageIds: ["11"],
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1, transcriptions: 1 });
    expect(transcriptions).toBe(2);
    // A higher update ID orders revisions sharing Telegram's one-second timestamp.
    await messages.capture({
      ...voice,
      fileId: "third-audio",
      updateId: "2",
      editedAt: editTime,
    });
    await messages.capture({
      ...voice,
      fileId: "stale-audio",
      updateId: "1",
      editedAt: editTime,
    });
    vi.setSystemTime(editTime.getTime() + 86400000);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1, transcriptions: 1 });
    expect(transcriptions).toBe(3);
    await messages.capture({
      ...voice,
      fileId: "duplicate-audio",
      updateId: "2",
      editedAt: editTime,
    });
    await messages.capture({
      ...voice,
      fileId: "outdated-audio",
      updateId: "10001",
      editedAt: new Date(editTime.getTime() - 1000),
    });
    vi.setSystemTime(editTime.getTime() + 2 * 86400000);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 0, transcriptions: 0 });
    expect(transcriptions).toBe(3);
    expect(
      (await messages.readMessages({ limit: 10 })).messages[1]?.fileId,
    ).toBe("third-audio");
    expect(
      (
        await api("discussions.read", { discussionId: initial.discussionId })
      ).json().discussion.messages,
    ).toMatchObject([
      { messageId: "10" },
      {
        messageId: "11",
        transcript: "Сначала определите задачу.",
        transcriptionStatus: "completed",
      },
    ]);
    expect(
      (await api("discussions.list", { limit: 10 })).json().items,
    ).toHaveLength(1);
  });

  it("adds tomorrow's answer to the same awaiting discussion and preserves manual marks", async () => {
    result.discussions[0] = {
      ...required(result.discussions[0]),
      messageIds: ["10"],
      answers: "",
      conclusion: "",
      answered: false,
    };
    await capture("10", "Как выбрать инструмент?");
    await application().get(CommunityDiscussionProcessor).processDue();
    const initial = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    );
    expect(initial.status).toBe("awaiting_answer");
    vi.setSystemTime(now.getTime() + 86_400_000);
    await capture("11", "Сначала определите задачу.");
    result.discussions[0] = {
      ...required(result.discussions[0]),
      discussionId: initial.discussionId,
      messageIds: ["11"],
      answers: "Сначала определите задачу.",
      answered: true,
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1 });
    expect(
      (
        await api("discussions.read", { discussionId: initial.discussionId })
      ).json().discussion,
    ).toMatchObject({
      status: "new",
      messages: [{ messageId: "10" }, { messageId: "11" }],
    });
    expect(
      (
        await api("discussions.mark", {
          discussionId: initial.discussionId,
          status: "reviewed",
          materialUrls: [],
        })
      ).statusCode,
    ).toBe(200);
    vi.setSystemTime(now.getTime() + 9 * 86_400_000);
    await capture("12", "Дополнительное пояснение");
    result.discussions[0] = {
      ...required(result.discussions[0]),
      messageIds: ["12"],
    };
    await application().get(CommunityDiscussionProcessor).processDue();
    expect(
      (
        await api("discussions.read", { discussionId: initial.discussionId })
      ).json().discussion.status,
    ).toBe("reviewed");
    const used = await api("discussions.mark", {
      requestId: "used-request",
      discussionId: initial.discussionId,
      status: "used",
      materialUrls: ["https://inside.example.test/materials/example"],
    });
    expect(used.statusCode).toBe(200);
    expect(
      (
        await api("discussions.mark", {
          requestId: "clear-request",
          discussionId: initial.discussionId,
          status: "new",
          materialUrls: [],
        })
      ).json().discussion.materialUrls,
    ).toEqual([]);
  });

  it("continues the matching topic without reply among identical existing questions", async () => {
    const captureTopic = async (
      messageId: string,
      threadId: string,
      text: string,
      sentAt: Date,
    ) => {
      await application().get(CommunityMessages).capture({
        botIdentity: "inside",
        chatId: "-1000000000000",
        updateId: messageId,
        messageId,
        threadId,
        replyToMessageId: null,
        sentAt,
        editedAt: null,
        senderTelegramUserId: "42",
        kind: "text",
        text,
        fileId: null,
      });
    };
    await captureTopic("10", "7", "Как выбрать инструмент?", now);
    await captureTopic(
      "20",
      "8",
      "Как выбрать инструмент?",
      new Date(now.getTime() - 3600000),
    );
    result.discussions = ["10", "20"].map((messageId) => ({
      discussionId: null,
      messageIds: [messageId],
      question: "Как выбрать инструмент?",
      answers: "",
      conclusion: "",
      answered: false,
    }));
    await application().get(CommunityDiscussionProcessor).processDue();
    const initial = (await api("discussions.list", { limit: 10 })).json().items;
    vi.setSystemTime(now.getTime() + 86400000);
    await captureTopic(
      "21",
      "8",
      "Сначала определите задачу.",
      new Date(now.getTime() + 86400000),
    );
    respond = (input) => {
      const matching = input.discussions.find((discussion) =>
        discussion.sources.some((source) => source.threadId === "8"),
      );
      expect(matching?.sources).toEqual([
        {
          messageId: "20",
          threadId: "8",
          replyToMessageId: null,
          sentAt: new Date(now.getTime() - 3600000).toISOString(),
        },
      ]);
      return Promise.resolve({
        discussions: [
          {
            discussionId: required(matching).discussionId,
            messageIds: ["21"],
            question: "Как выбрать инструмент?",
            answers: "Сначала определите задачу.",
            conclusion: "Выбор зависит от задачи.",
            answered: true,
          },
        ],
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1 });
    const saved = (await api("discussions.list", { limit: 10 })).json().items;
    expect(saved).toHaveLength(2);
    const answered = required(
      saved.find((discussion) => discussion.status === "new"),
    );
    expect(initial.map((discussion) => discussion.discussionId)).toContain(
      answered.discussionId,
    );
    expect(
      (
        await api("discussions.read", { discussionId: answered.discussionId })
      ).json().discussion.messages,
    ).toMatchObject([
      { messageId: "20", threadId: "8" },
      { messageId: "21", threadId: "8", replyToMessageId: null },
    ]);
  });

  it("retries provider failure without losing messages or duplicating saved results", async () => {
    await capture("10", "Как выбрать инструмент?");
    await capture("11", "Сначала определите задачу.");
    failure = new Error("synthetic provider failure");
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "failed", messages: 0 });
    expect((await api("discussions.list", { limit: 10 })).json().items).toEqual(
      [],
    );
    const startResponse = await application().inject({
      method: "POST",
      url: "/webhooks/telegram",
      headers: {
        "x-telegram-bot-api-secret-token":
          "synthetic_webhook_secret_for_tests_only",
      },
      payload: {
        update_id: 100,
        message: {
          message_id: 100,
          date: now.getTime() / 1000,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Synthetic" },
          text: "/start",
        },
      },
    });
    expect(startResponse.statusCode).toBe(202);
    expect(
      await application()
        .get(TelegramUpdateProcessor)
        .processAvailable(10, now),
    ).toBe(1);
    failure = undefined;
    vi.setSystemTime(now.getTime() + 300_000);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 2 });
    expect(
      (await api("discussions.list", { limit: 10 })).json().items,
    ).toHaveLength(1);
  });

  it.each([
    { label: "unknown message", ids: ["999"], discussionId: null },
    { label: "repeated message", ids: ["10", "10"], discussionId: null },
    {
      label: "unknown discussion",
      ids: ["10"],
      discussionId: "11111111-1111-4111-8111-111111111111",
    },
  ])(
    "rejects $label from the model without acknowledging messages",
    async ({ ids, discussionId }) => {
      await capture("10", "Как выбрать инструмент?");
      result.discussions[0] = {
        ...required(result.discussions[0]),
        messageIds: ids,
        discussionId,
      };
      expect(
        await application().get(CommunityDiscussionProcessor).processDue(),
      ).toMatchObject({ status: "failed", messages: 0 });
      expect(
        (await api("discussions.list", { limit: 10 })).json().items,
      ).toEqual([]);
      vi.setSystemTime(now.getTime() + 300_000);
      result.discussions[0] = {
        ...required(result.discussions[0]),
        messageIds: ["10"],
        discussionId: null,
      };
      expect(
        await application().get(CommunityDiscussionProcessor).processDue(),
      ).toMatchObject({ status: "completed", messages: 1 });
    },
  );

  it("acknowledges chatter without creating a discussion", async () => {
    await capture("10", "Всем хорошего дня!");
    result.discussions = [];
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1, discussions: 0 });
    vi.setSystemTime(now.getTime() + 86_400_000);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 0 });
    expect(inputs).toHaveLength(1);
  });

  it("authenticates the service separately and rechecks author permission before receipt replay", async () => {
    expect((await api("discussions.list", { limit: 10 }, "")).statusCode).toBe(
      401,
    );
    expect(
      (
        await api(
          "discussions.list",
          { limit: 10 },
          "Bearer synthetic_platform_secret_for_tests_only",
        )
      ).statusCode,
    ).toBe(401);
    permission = "denied";
    expect((await api("discussions.list", { limit: 10 })).statusCode).toBe(403);
    permission = "unavailable";
    expect((await api("discussions.list", { limit: 10 })).statusCode).toBe(503);
    transcriptions = 0;
    downloads = 0;
    transcriptionFailure = false;
    permission = "allowed";
    await capture("10", "Как выбрать инструмент?");
    await capture("11", "Сначала определите задачу.");
    await application().get(CommunityDiscussionProcessor).processDue();
    const id = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    ).discussionId;
    const command = { discussionId: id, status: "reviewed", materialUrls: [] };
    const first = await api("discussions.mark", command);
    expect((await api("discussions.mark", command)).json()).toEqual(
      first.json(),
    );
    expect(
      (await api("discussions.mark", { ...command, status: "new" })).statusCode,
    ).toBe(409);
    permission = "denied";
    expect((await api("discussions.mark", command)).statusCode).toBe(403);
  });

  it("stores messages without a model key and leaves them for a configured run", async () => {
    await application().close();
    app = undefined;
    await start(false);
    await capture("10", "Как выбрать инструмент?");
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "unconfigured" });
    expect(
      (await application().get(CommunityMessages).readMessages({ limit: 10 }))
        .messages,
    ).toHaveLength(1);
    expect(inputs).toHaveLength(0);
  });

  it("keeps summaries and source links after raw message retention", async () => {
    await capture(
      "10",
      "Как выбрать инструмент?",
      "42",
      new Date(now.getTime() - 91 * 86_400_000),
    );
    await capture(
      "11",
      "Сначала определите задачу.",
      "43",
      new Date(now.getTime() - 91 * 86_400_000),
    );
    await application().get(CommunityDiscussionProcessor).processDue();
    const id = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    ).discussionId;
    await purgeExpiredRecords(database, now, {
      membershipCheckDays: 90,
      salesFunnelEventDays: 30,
    });
    const read = await api("discussions.read", { discussionId: id });
    expect(read.json().discussion).toMatchObject({
      question: "Как выбрать инструмент?",
      conclusion: "Выбор зависит от задачи.",
      messages: [
        {
          messageId: "10",
          text: null,
          sourceUrl: "https://t.me/c/0000000000/10",
        },
        { messageId: "11", text: null },
      ],
    });
  });

  it("defers the finite snapshot until author roles resolve and preserves related answers", async () => {
    await seedCommunityBinding(
      database,
      {
        accountRef: "synthetic-author",
        linkRef: "synthetic-author-link",
        linkRevision: 1,
        telegramIdentityRef: "synthetic-author-identity",
      },
      now,
      "81",
    );
    permission = "unavailable";
    await capture("1", "Вопрос автора", "81");
    for (let id = 2; id <= 201; id += 1)
      await capture(
        String(id),
        id === 2 ? "Связанный ответ" : "Обычный разговор",
      );
    result.discussions = [];
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "failed", messages: 0 });
    expect(inputs).toHaveLength(0);
    const startResponse = await application().inject({
      method: "POST",
      url: "/webhooks/telegram",
      headers: {
        "x-telegram-bot-api-secret-token":
          "synthetic_webhook_secret_for_tests_only",
      },
      payload: {
        update_id: 1000,
        message: {
          message_id: 1000,
          date: now.getTime() / 1000,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false },
          text: "/start",
        },
      },
    });
    expect(startResponse.statusCode).toBe(202);
    expect(
      await application()
        .get(TelegramUpdateProcessor)
        .processAvailable(10, now),
    ).toBe(1);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "not_due" });
    transcriptions = 0;
    downloads = 0;
    transcriptionFailure = false;
    permission = "allowed";
    vi.setSystemTime(now.getTime() + 300_000);
    result.discussions = [
      {
        discussionId: null,
        messageIds: ["1", "2"],
        question: "Вопрос автора",
        answers: "Связанный ответ",
        conclusion: "",
        answered: true,
      },
    ];
    respond = (input) =>
      Promise.resolve({
        ...result,
        discussions: input.messages.some((message) => message.messageId === "1")
          ? result.discussions
          : [],
      });
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 201 });
    expect(inputs[0]?.messages.slice(0, 2)).toMatchObject([
      { messageId: "1", role: "автор" },
      { messageId: "2", text: "Связанный ответ" },
    ]);
    const saved = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    );
    expect(saved.status).toBe("new");
    expect(
      (
        await api("discussions.read", { discussionId: saved.discussionId })
      ).json().discussion.messages,
    ).toMatchObject([{ messageId: "1" }, { messageId: "2" }]);
  });

  it("excludes overlapping daily claims and preserves a mark committed while grouping waits", async () => {
    await capture("10", "Как выбрать инструмент?");
    await capture("11", "Сначала определите задачу.");
    await application().get(CommunityDiscussionProcessor).processDue();
    const id = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    ).discussionId;
    await capture("12", "Дополнительное пояснение");
    vi.setSystemTime(now.getTime() + 86_400_000);
    const entered = deferred();
    const release = deferred();
    result.discussions[0] = {
      ...required(result.discussions[0]),
      discussionId: id,
      messageIds: ["12"],
    };
    respond = async () => {
      entered.resolve();
      await release.promise;
      return result;
    };
    const pending = application()
      .get(CommunityDiscussionProcessor)
      .processDue();
    try {
      await entered.promise;
      expect(
        await application().get(CommunityDiscussionProcessor).processDue(),
      ).toMatchObject({ status: "not_due" });
      expect(
        (
          await api("discussions.mark", {
            discussionId: id,
            status: "used",
            materialUrls: ["https://inside.example.test/materials/example"],
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      release.resolve();
    }
    expect(await pending).toMatchObject({ status: "completed", messages: 1 });
    expect(
      (await api("discussions.read", { discussionId: id })).json().discussion,
    ).toMatchObject({
      status: "used",
      materialUrls: ["https://inside.example.test/materials/example"],
    });
  });

  it("rolls back grouping when a new edit arrives during the model call", async () => {
    await capture("10", "Как выбрать инструмент?");
    result.discussions[0] = {
      ...required(result.discussions[0]),
      messageIds: ["10"],
    };
    respond = async () => {
      await application().get(CommunityMessages).capture({
        botIdentity: "inside",
        chatId: "-1000000000000",
        updateId: "11",
        messageId: "10",
        threadId: "7",
        replyToMessageId: null,
        sentAt: now,
        editedAt: now,
        senderTelegramUserId: "42",
        kind: "text",
        text: "Исправленный вопрос",
        fileId: null,
      });
      return result;
    };
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "failed", messages: 0 });
    expect((await api("discussions.list", { limit: 10 })).json().items).toEqual(
      [],
    );
    respond = undefined;
    vi.setSystemTime(now.getTime() + 300_000);
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1 });
    expect(inputs[1]?.messages[0]?.text).toBe("Исправленный вопрос");
  });

  it("round-trips long fractional date filters across tied-date pages", async () => {
    await capture("10", "Первый вопрос?");
    await capture("11", "Второй вопрос?", "43");
    result.discussions = [
      {
        ...required(result.discussions[0]),
        messageIds: ["10"],
        question: "Первый вопрос?",
      },
      {
        ...required(result.discussions[0]),
        messageIds: ["11"],
        question: "Второй вопрос?",
      },
    ];
    await application().get(CommunityDiscussionProcessor).processDue();
    const first = (
      await api("discussions.list", {
        limit: 1,
        status: "new",
        from: now.toISOString().replace(".000Z", `.${"0".repeat(1600)}Z`),
        to: now.toISOString(),
      })
    ).json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (
      await api("discussions.list", {
        limit: 1,
        status: "new",
        from: now.toISOString(),
        to: now.toISOString(),
        cursor: first.nextCursor,
      })
    ).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(required(second.items[0]).discussionId).not.toBe(
      required(first.items[0]).discussionId,
    );
    expect(
      (
        await api("discussions.list", {
          limit: 1,
          status: "used",
          cursor: first.nextCursor,
        })
      ).statusCode,
    ).toBe(400);
  });
  it("renews its claim between slow author-resolution pages", async () => {
    for (const id of ["81", "82"])
      await seedCommunityBinding(
        database,
        {
          accountRef: `synthetic-author-${id}`,
          linkRef: `synthetic-link-${id}`,
          linkRevision: 1,
          telegramIdentityRef: `synthetic-identity-${id}`,
        },
        now,
        id,
      );
    await capture("1", "Вопрос автора", "81");
    for (let id = 2; id <= 20; id += 1) await capture(String(id), "Разговор");
    await capture("21", "Другой вопрос автора", "82");
    let elapsed = 0;
    authorize = () => {
      elapsed += 170_000;
      vi.setSystemTime(now.getTime() + elapsed);
      return Promise.resolve("allowed");
    };
    result.discussions = [];
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 21 });
  });
  it("keeps an unresolved role pending when shutdown interrupts author resolution", async () => {
    await seedCommunityBinding(
      database,
      {
        accountRef: "synthetic-author",
        linkRef: "synthetic-link",
        linkRevision: 1,
        telegramIdentityRef: "synthetic-identity",
      },
      now,
      "81",
    );
    await capture("1", "Вопрос автора", "81");
    const entered = deferred();
    const release = deferred();
    authorize = async () => {
      entered.resolve();
      await release.promise;
      return "allowed";
    };
    const cancellation = new AbortController();
    const pending = application()
      .get(CommunityDiscussionProcessor)
      .processDue(cancellation.signal);
    try {
      await entered.promise;
      cancellation.abort();
    } finally {
      release.resolve();
    }
    expect(await pending).toMatchObject({ status: "failed", messages: 0 });
    expect(
      (await application().get(CommunityMessages).readMessages({ limit: 10 }))
        .messages[0]?.isAuthor,
    ).toBeNull();
    expect(inputs).toHaveLength(0);
  });
  it("defers messages arriving during author resolution to the next finite run", async () => {
    await seedCommunityBinding(
      database,
      {
        accountRef: "synthetic-author",
        linkRef: "synthetic-link",
        linkRevision: 1,
        telegramIdentityRef: "synthetic-identity",
      },
      now,
      "81",
    );
    await capture("1", "Вопрос автора", "81");
    authorize = async () => {
      await capture("2", "Новое сообщение");
      return "allowed";
    };
    result.discussions = [];
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1 });
    expect(inputs[0]?.messages.map((message) => message.messageId)).toEqual([
      "1",
    ]);
    vi.setSystemTime(now.getTime() + 86_400_000);
    authorize = undefined;
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1 });
    expect(inputs[1]?.messages.map((message) => message.messageId)).toEqual([
      "2",
    ]);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
