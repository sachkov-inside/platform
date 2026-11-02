import {
  communityDiscussionsSuccessSchema,
  type CommunityDiscussionsRequest,
  type CommunityDiscussionsSuccess,
} from "@inside/contracts/community-discussions";
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
  transcribe: () => Promise.reject(new Error("Not enabled")),
};

beforeAll(async () => {
  await migrateToLatest(database);
});
beforeEach(async () => {
  await sql`truncate community_discussion_mark_receipts, community_discussion_sources, community_discussions, community_discussion_schedule, community_messages, telegram_updates, bot_contacts, start_response_deliveries, platform_links, link_transactions restart identity cascade`.execute(
    database,
  );
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
async function start(grouping = true) {
  const config = loadApplicationConfig({
    DATABASE_URL: required(process.env["DATABASE_URL"]),
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
    TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
    PLATFORM_COMMUNITY_DISCUSSIONS_SECRET: secret,
    ...(grouping
      ? {
          COMMUNITY_DISCUSSIONS_MODEL_BASE_URL: "http://127.0.0.1:19999/v1",
          COMMUNITY_DISCUSSIONS_MODEL_API_KEY: "synthetic",
          COMMUNITY_DISCUSSIONS_MODEL: "synthetic-model",
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
    .overrideProvider(COMMUNITY_DISCUSSION_MODEL)
    .useValue(model)
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
  it("reprocesses a later edit in its existing discussion without duplicate membership", async () => {
    await capture("10", "Как выбрать инструмент?");
    await capture("11", "Сначала определите задачу.");
    await application().get(CommunityDiscussionProcessor).processDue();
    const initial = required(
      (await api("discussions.list", { limit: 10 })).json().items[0],
    );
    vi.setSystemTime(now.getTime() + 8 * 86_400_000);
    await application()
      .get(CommunityMessages)
      .capture({
        botIdentity: "inside",
        chatId: "-1000000000000",
        updateId: "12",
        messageId: "10",
        threadId: "7",
        replyToMessageId: null,
        sentAt: now,
        editedAt: new Date(now.getTime() + 8 * 86_400_000),
        senderTelegramUserId: "42",
        kind: "text",
        text: "Уточнённый вопрос",
        fileId: null,
      });
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

  it("continues every author-resolution page and defers still unavailable messages", async () => {
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
      await capture(String(id), "Обычный разговор");
    result.discussions = [];
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 200 });
    expect(inputs[0]?.messages).toHaveLength(200);
    expect(
      inputs[0]?.messages.some((message) => message.messageId === "1"),
    ).toBe(false);
    permission = "allowed";
    vi.setSystemTime(now.getTime() + 86_400_000);
    result.discussions = [
      {
        discussionId: null,
        messageIds: ["1"],
        question: "Вопрос автора",
        answers: "",
        conclusion: "",
        answered: false,
      },
    ];
    expect(
      await application().get(CommunityDiscussionProcessor).processDue(),
    ).toMatchObject({ status: "completed", messages: 1 });
    expect(inputs[1]?.messages).toMatchObject([
      { messageId: "1", role: "автор" },
    ]);
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

  it("paginates tied dates without duplicates and binds continuation to filters", async () => {
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
        from: now.toISOString(),
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
