import { purgeExpiredRecords } from "../../src/database/retention.js";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  AUTHOR_AUTHORIZATION,
  type AuthorAuthorization,
} from "../../src/modules/communications/author-authorization.js";
import { seedCommunityBinding } from "../support/community-binding.js";
import { sql } from "kysely";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { AppModule } from "../../src/app.module.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { CommunityMessages } from "../../src/modules/community-discussions/community-messages.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";
import { required } from "../support/required.js";

registerFixedClock();
const now = new Date(fixedTestInstant());
const database = createDatabase(required(process.env["DATABASE_URL"]));
const chatId = -1000000000000;
let application: NestFastifyApplication | undefined;

beforeAll(async () => {
  await migrateToLatest(database);
});
beforeEach(async () => {
  await sql`truncate community_messages, telegram_updates, communication_author_modes, platform_links, link_transactions, bot_contacts restart identity cascade`.execute(
    database,
  );
});
afterEach(async () => {
  await application?.close();
  application = undefined;
});
afterAll(async () => {
  await database.destroy();
});

async function start(
  topicIds?: readonly number[],
  authorization?: AuthorAuthorization,
) {
  const config = loadApplicationConfig({
    DATABASE_URL: required(process.env["DATABASE_URL"]),
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_CANONICAL_CHAT_ID: String(chatId),
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
    TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
    ...(topicIds === undefined
      ? {}
      : { TELEGRAM_COMMUNITY_DISCUSSIONS_TOPIC_IDS: JSON.stringify(topicIds) }),
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic non member",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
    WORKERS_ENABLED: "false",
  });
  const builder = Test.createTestingModule({
    imports: [AppModule.register(config)],
  });
  if (authorization)
    builder.overrideProvider(AUTHOR_AUTHORIZATION).useValue(authorization);
  const module = await builder.compile();
  application = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  return application;
}

function message(messageId: number, fields: Record<string, unknown> = {}) {
  return {
    message_id: messageId,
    date: now.getTime() / 1000,
    chat: { id: chatId, type: "supergroup" },
    from: { id: 42, is_bot: false, first_name: "Synthetic participant" },
    text: "Как выбрать инструмент?",
    ...fields,
  };
}

async function webhook(
  app: NestFastifyApplication,
  updateId: number,
  value: Record<string, unknown>,
  kind = "message",
) {
  const response = await app.inject({
    method: "POST",
    url: "/webhooks/telegram",
    headers: {
      "x-telegram-bot-api-secret-token":
        "synthetic_webhook_secret_for_tests_only",
    },
    payload: { update_id: updateId, [kind]: value },
  });
  expect(response.statusCode).toBe(202);
  await app.get(TelegramUpdateProcessor).processAvailable(100, now);
}

describe("community message capture", () => {
  it("makes a group question with its topic and reply available to discussion processing", async () => {
    const app = await start();
    await webhook(
      app,
      1,
      message(10, {
        message_thread_id: 7,
        reply_to_message: { message_id: 9 },
      }),
    );
    expect(
      await app.get(CommunityMessages).readMessages({ limit: 10 }),
    ).toEqual({
      messages: [
        {
          botIdentity: "inside",
          chatId: String(chatId),
          messageId: "10",
          threadId: "7",
          replyToMessageId: "9",
          sentAt: now,
          editedAt: null,
          senderTelegramUserId: "42",
          isAuthor: null,
          kind: "text",
          text: "Как выбрать инструмент?",
          fileId: null,
        },
      ],
      nextAfter: null,
    });
  });
  it("keeps photo and document captions from different topics and the general topic", async () => {
    const app = await start();
    await webhook(
      app,
      1,
      message(10, {
        text: undefined,
        caption: "Что на скриншоте?",
        photo: [
          {
            file_id: "synthetic-photo",
            file_unique_id: "photo",
            width: 10,
            height: 10,
          },
        ],
        message_thread_id: 7,
      }),
    );
    await webhook(
      app,
      2,
      message(11, {
        text: undefined,
        caption: "Что исправить в документе?",
        document: { file_id: "synthetic-document", file_unique_id: "document" },
        message_thread_id: 8,
      }),
    );
    await webhook(app, 3, message(12));
    const page = await app.get(CommunityMessages).readMessages({ limit: 10 });
    expect(
      page.messages.map(({ messageId, threadId, kind, text }) => ({
        messageId,
        threadId,
        kind,
        text,
      })),
    ).toEqual([
      {
        messageId: "10",
        threadId: "7",
        kind: "photo",
        text: "Что на скриншоте?",
      },
      {
        messageId: "11",
        threadId: "8",
        kind: "document",
        text: "Что исправить в документе?",
      },
      {
        messageId: "12",
        threadId: null,
        kind: "text",
        text: "Как выбрать инструмент?",
      },
    ]);
  });

  it("applies edits once and does not replace the final text with an older update", async () => {
    const app = await start();
    const original = message(10, {
      message_thread_id: 7,
      reply_to_message: { message_id: 9 },
    });
    await webhook(app, 1, original);
    await webhook(
      app,
      3,
      {
        ...original,
        text: "Уточнённый вопрос",
        edit_date: now.getTime() / 1000 + 60,
      },
      "edited_message",
    );
    await webhook(
      app,
      2,
      {
        ...original,
        text: "Старая правка",
        edit_date: now.getTime() / 1000 + 30,
      },
      "edited_message",
    );
    await webhook(
      app,
      3,
      { ...original, text: "Повтор обновления" },
      "edited_message",
    );
    const page = await app.get(CommunityMessages).readMessages({ limit: 10 });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({
      messageId: "10",
      text: "Уточнённый вопрос",
      sentAt: now,
      editedAt: new Date(now.getTime() + 60_000),
      threadId: "7",
      replyToMessageId: "9",
    });
  });

  it("resolves authors through confirmed Platform permission without temporary AuthorMode", async () => {
    const app = await start(undefined, {
      authorize: (subject) =>
        Promise.resolve(
          subject.accountRef === "synthetic-author" ? "allowed" : "denied",
        ),
    });
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
    await seedCommunityBinding(
      database,
      {
        accountRef: "synthetic-participant",
        linkRef: "synthetic-participant-link",
        linkRevision: 1,
        telegramIdentityRef: "synthetic-participant-identity",
      },
      now,
      "82",
    );
    await webhook(app, 1, message(10, { from: { id: 81, is_bot: false } }));
    await webhook(app, 2, message(11, { from: { id: 82, is_bot: false } }));
    await webhook(app, 3, message(12));
    await app.get(CommunityMessages).resolveAuthors({ limit: 10 });
    expect(
      (
        await app.get(CommunityMessages).readMessages({ limit: 10 })
      ).messages.map(({ isAuthor }) => isAuthor),
    ).toEqual([true, false, false]);
  });

  it("preserves unavailable author roles and continues past them before retrying", async () => {
    let permission: "allowed" | "unavailable" = "unavailable";
    let authorizationRequests = 0;
    const app = await start(undefined, {
      authorize: () => {
        authorizationRequests += 1;
        return Promise.resolve(permission);
      },
    });
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
    await webhook(app, 1, message(10, { from: { id: 81, is_bot: false } }));
    await webhook(app, 2, message(11));
    expect(authorizationRequests).toBe(0);
    const messages = app.get(CommunityMessages);
    expect(
      (await messages.readMessages({ limit: 10 })).messages.map(
        ({ isAuthor }) => isAuthor,
      ),
    ).toEqual([null, null]);
    const first = await messages.resolveAuthors({ limit: 1 });
    expect(first).toEqual({ resolved: 0, nextAfter: "10" });
    expect(
      await messages.resolveAuthors({
        limit: 1,
        after: required(first.nextAfter),
      }),
    ).toEqual({ resolved: 1, nextAfter: null });
    expect(
      (await messages.readMessages({ limit: 10 })).messages.map(
        ({ isAuthor }) => isAuthor,
      ),
    ).toEqual([null, false]);
    permission = "allowed";
    expect(await messages.resolveAuthors({ limit: 10 })).toEqual({
      resolved: 1,
      nextAfter: null,
    });
    expect(
      (await messages.readMessages({ limit: 10 })).messages.map(
        ({ isAuthor }) => isAuthor,
      ),
    ).toEqual([true, false]);
  });

  it("ignores other chats, bots and service updates and honors the topic allowlist", async () => {
    const app = await start([7]);
    await webhook(app, 1, message(10, { message_thread_id: 7 }));
    await webhook(app, 2, message(11, { message_thread_id: 8 }));
    await webhook(app, 3, message(12));
    await webhook(
      app,
      4,
      message(13, {
        message_thread_id: 7,
        chat: { id: -1000000000001, type: "supergroup" },
      }),
    );
    await webhook(
      app,
      5,
      message(14, { message_thread_id: 7, chat: { id: 42, type: "private" } }),
    );
    await webhook(
      app,
      6,
      message(15, { message_thread_id: 7, from: { id: 81, is_bot: true } }),
    );
    await webhook(
      app,
      7,
      message(16, {
        message_thread_id: 7,
        text: undefined,
        new_chat_members: [{ id: 81, is_bot: false }],
      }),
    );
    await webhook(
      app,
      8,
      message(17, {
        message_thread_id: 7,
        text: undefined,
        left_chat_member: { id: 81, is_bot: false },
      }),
    );
    expect(
      (
        await app.get(CommunityMessages).readMessages({ limit: 10 })
      ).messages.map(({ messageId }) => messageId),
    ).toEqual(["10"]);
  });

  it("deletes raw content strictly after 90 days counted from the original message", async () => {
    const app = await start();
    const cutoff = now.getTime() / 1000 - 90 * 86_400;
    await webhook(app, 1, message(10, { date: cutoff - 1 }));
    await webhook(app, 2, message(11, { date: cutoff }));
    await webhook(app, 3, message(12, { date: cutoff + 1 }));
    await webhook(
      app,
      4,
      message(10, {
        date: cutoff - 1,
        text: "Недавняя правка старого сообщения",
        edit_date: now.getTime() / 1000,
      }),
      "edited_message",
    );
    await purgeExpiredRecords(database, now, {
      membershipCheckDays: 90,
      salesFunnelEventDays: 30,
    });
    const messages = app.get(CommunityMessages);
    expect(
      (await messages.readMessages({ limit: 10 })).messages.map(
        ({ messageId }) => messageId,
      ),
    ).toEqual(["11", "12"]);
    expect(
      await purgeExpiredRecords(database, now, {
        membershipCheckDays: 90,
        salesFunnelEventDays: 30,
      }),
    ).toBe(0);
  });

  it("removes a photo caption when the edited message no longer has it", async () => {
    const app = await start();
    const photo = message(10, {
      text: undefined,
      caption: "Старый вопрос",
      photo: [{ file_id: "synthetic-photo" }],
    });
    await webhook(app, 1, photo);
    await webhook(
      app,
      2,
      { ...photo, caption: undefined, edit_date: now.getTime() / 1000 + 60 },
      "edited_message",
    );
    expect(
      (await app.get(CommunityMessages).readMessages({ limit: 10 }))
        .messages[0],
    ).toMatchObject({ messageId: "10", kind: "photo", text: "" });
  });

  it("returns traversable message pages in numeric Telegram message order", async () => {
    const app = await start();
    await webhook(app, 1, message(11));
    await webhook(app, 2, message(2));
    await webhook(app, 3, message(10));
    const messages = app.get(CommunityMessages);
    const first = await messages.readMessages({ limit: 2 });
    expect(first.messages.map(({ messageId }) => messageId)).toEqual([
      "2",
      "10",
    ]);
    expect(first.nextAfter).toBe("10");
    const second = await messages.readMessages({
      limit: 2,
      after: required(first.nextAfter),
    });
    expect(second.messages.map(({ messageId }) => messageId)).toEqual(["11"]);
    expect(second.nextAfter).toBeNull();
  });
});
