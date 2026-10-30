import { GrammyNativeMessageArchive } from "../../src/adapters/telegram/grammy-native-message-archive.adapter.js";
import { nativeMessageCopiesMigration } from "../../src/database/migrations/039-native-message-copies.js";
import type { NativeMessageSource } from "../../src/modules/communications/native-message-source.js";
import { randomUUID } from "node:crypto";
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
import {
  registerFixedClock,
  fixedTestInstant,
} from "../support/fixed-clock.js";
import { createFixtureDatabase } from "../support/fixture-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { NativeMessages } from "../../src/modules/communications/native-messages.js";
import { NativeCommunicationTransport } from "../../src/modules/communications/native-communication-transport.js";
import { Communications } from "../../src/modules/communications/communications.js";
import { CommunicationSequences } from "../../src/modules/communications/communication-sequences.js";
import { AuthorAdmin } from "../../src/modules/communications/author-admin.js";
import { AuthorDelivery } from "../../src/modules/communications/author-delivery.js";
import { emptyAuthorState } from "../../src/modules/communications/author-dialog.js";
import { translateTemplateIntake } from "../../src/adapters/telegram/grammy-template-intake.adapter.js";
import type {
  NativeCopyCommand,
  NativeCopyResult,
} from "../../src/modules/communications/native-message-copy.js";
import type {
  TemplateContent,
  CommunicationsRequest,
} from "../../src/modules/communications/communications-contract.js";
import type { TemplateIntake } from "../../src/modules/communications/author-input.js";
import { required } from "../support/required.js";
registerFixedClock();
const databaseUrl = required(process.env["DATABASE_URL"]);
const database = createFixtureDatabase(databaseUrl, "native_messages_fixture");
const config = {
  ...loadApplicationConfig({
    DATABASE_URL: databaseUrl,
    TELEGRAM_BOT_IDENTITY: "inside",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests_only",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests_only",
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic nonmember",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
    WORKERS_ENABLED: "false",
  }),
  deliveryMode: "live" as const,
};
const authorization = {
  result: "allowed" as "allowed" | "denied" | "unavailable",
  authorize: vi.fn(() => Promise.resolve(authorization.result)),
};
const calls: NativeCopyCommand[] = [];
let result: NativeCopyResult;
let duringCopy: (() => Promise<void>) | undefined;
const copy = {
  archive: async (command: {
    chatId: string;
    sources: readonly NativeMessageSource[];
  }) => {
    const outcome = await copy.copy({
      chatId: command.chatId,
      sourceChatId: command.chatId,
      messageIds: command.sources.map((item) => item.messageId),
      buttons: [],
    });
    return outcome.kind === "delivered"
      ? { ...outcome, sources: command.sources }
      : outcome;
  },
  copy: vi.fn(async (command: NativeCopyCommand): Promise<NativeCopyResult> => {
    calls.push(structuredClone(command));
    await duringCopy?.();
    return result;
  }),
};
const clock = { now: () => new Date(fixedTestInstant()) };
const native = new NativeMessages(database, config, authorization, copy, clock);
const posts = new Communications(database, config, authorization, native);
const validation = {
  validate: vi.fn(() =>
    Promise.resolve({ status: "ok" as const, targetErrors: [] }),
  ),
};
const sequences = new CommunicationSequences(
  database,
  config,
  authorization,
  clock,
  validation,
  undefined,
  native,
);
const legacy = {
  send: vi.fn(() =>
    Promise.resolve({
      kind: "delivered" as const,
      providerMessageId: "legacy",
    }),
  ),
};
const transport = new NativeCommunicationTransport(legacy, native, copy);
const delivery = new AuthorDelivery(database, config, authorization, transport);
const admin = new AuthorAdmin(
  database,
  config,
  authorization,
  posts,
  sequences,
  delivery,
  validation,
  native,
);
const identity = {
  botIdentity: "inside",
  telegramUserId: "42",
  privateChatId: "42",
};
const source = (id: number, group?: string) => ({
  messageId: id,
  text: "Synthetic caption",
  links: [],
  ...(group !== undefined ? { mediaGroupId: group } : {}),
});
function input(
  updateId: string,
  body: Partial<TemplateIntake> = {},
): TemplateIntake {
  return { ...identity, updateId, action: "capture", content: null, ...body };
}
function request(
  content: TemplateContent,
  actor = "synthetic-author",
): CommunicationsRequest {
  return {
    contractVersion: "inside-communications-v2",
    operation: "templates.save",
    operationId: randomUUID(),
    expectedRevision: 0,
    actor: { accountRef: actor },
    payload: { templateId: randomUUID(), content },
  };
}
async function templates() {
  return database.selectFrom("communication_templates").selectAll().execute();
}
async function archives() {
  return database
    .selectFrom("communication_native_copies")
    .selectAll()
    .execute();
}
async function open(updateId = "1") {
  await posts.intake(input(updateId, { action: "open" }));
}
beforeAll(() => migrateToLatest(database));
beforeEach(async () => {
  await sql`truncate communication_native_copies, communication_templates, communication_author_modes,
    communication_author_sessions, communication_author_receipts, communication_author_outbox, communication_author_compositions,
    communication_author_drafts, communication_intake_receipts, communication_operations, telegram_transport_slots,
    link_transactions, platform_links, start_response_deliveries restart identity cascade`.execute(
    database,
  );
  const now = clock.now();
  await database
    .insertInto("link_transactions")
    .values({
      account_ref: "synthetic-author",
      bot_identity: "inside",
      candidate_telegram_user_id: "42",
      confirmed_at: now,
      expires_at: now,
      link_transaction_ref: "synthetic-link",
      received_at: now,
      registered_at: now,
      return_correlation: "synthetic-return",
      state: "linked",
      token_digest: "a".repeat(43),
    })
    .execute();
  await database
    .insertInto("platform_links")
    .values({
      account_ref: "synthetic-author",
      bot_identity: "inside",
      evidence_version: 0,
      last_membership_observation_at: null,
      last_membership_observation_update_id: null,
      link_transaction_ref: "synthetic-link",
      linked_at: now,
      telegram_identity_ref: "synthetic-identity",
      telegram_user_id: "42",
    })
    .execute();
  calls.length = 0;
  // deterministic-test-allow shared-mutation: This beforeEach owns and resets the synthetic authorization result for every sequential case.
  authorization.result = "allowed";
  duringCopy = undefined;
  result = { kind: "delivered", messageIds: [501] };
  copy.copy.mockClear();
  legacy.send.mockClear();
});
afterAll(() => database.destroy());

describe("native message archive on PostgreSQL with synthetic Telegram", () => {
  it.each([
    "text",
    "photo",
    "video",
    "animation",
    "audio",
    "voice",
    "video_note",
    "document",
    "sticker",
    "poll",
    "contact",
    "location",
    "venue",
    "dice",
    "rich_message",
    "live_photo",
  ])(
    "captures and delivers %s from a durable copy after the original disappears",
    async (kind) => {
      await open();
      const update = {
        message: {
          message_id: 7,
          from: { id: 42, is_bot: false },
          chat: { id: 42, type: "private" },
          [kind]: "synthetic",
        },
      };
      const intake = required(translateTemplateIntake("inside", "2", update));
      await posts.intake(intake);
      const saved = required((await templates())[0]);
      expect(saved.content.type).toBe("native");
      expect(calls).toEqual([
        { chatId: "42", sourceChatId: "42", messageIds: [7], buttons: [] },
      ]);
      // Original message 7 is no longer available. Only the independently copied 501 can be sent.
      result = { kind: "delivered", messageIds: [601] };
      expect(
        await transport.send({ chatId: "84", content: saved.content }),
      ).toEqual({ kind: "delivered", providerMessageId: "601" });
      expect(calls[1]).toMatchObject({
        chatId: "84",
        sourceChatId: "42",
        messageIds: [501],
      });
      await posts.intake(intake);
      expect(calls).toHaveLength(2);
      expect(await templates()).toHaveLength(1);
      expect(legacy.send).not.toHaveBeenCalled();
    },
  );
  it("collects repeated/out-of-order album updates and finishes only on /done", async () => {
    await open();
    await posts.intake(input("2", { nativeSource: source(9, "album") }));
    await posts.intake(input("3", { nativeSource: source(7, "album") }));
    await posts.intake(input("3", { nativeSource: source(7, "album") }));
    expect(calls).toHaveLength(0);
    expect(await templates()).toHaveLength(0);
    result = { kind: "delivered", messageIds: [501, 502] };
    await posts.intake(input("4", { action: "finish", text: "/done" }));
    const saved = required((await templates())[0]);
    expect(saved.content.nativeCount).toBe(2);
    expect(calls[0]?.messageIds).toEqual([7, 9]);
    await posts.intake(input("4", { action: "finish", text: "/done" }));
    expect(calls).toHaveLength(1);
    await transport.send({ chatId: "84", content: saved.content });
    expect(calls[1]?.messageIds).toEqual([501, 502]);
  });
  it.each(["transport_unknown", "partial"] as const)(
    "never replays an ambiguous %s copy after restart",
    async (kind) => {
      await open();
      result = kind === "partial" ? { kind, messageIds: [501] } : { kind };
      await posts.intake(input("2", { nativeSource: source(7, "album") }));
      await posts.intake(input("3", { nativeSource: source(8, "album") }));
      await posts.intake(input("4", { action: "finish", text: "/done" }));
      const restarted = new NativeMessages(
        database,
        config,
        authorization,
        copy,
        clock,
      );
      expect(
        (
          await restarted.prepare(
            input("5", { action: "finish", text: "/done" }),
            "template",
          )
        ).kind,
      ).toBe("waiting");
      expect(calls).toHaveLength(1);
      expect((await archives())[0]?.state).toBe("unknown");
      expect(await templates()).toHaveLength(0);
    },
  );
  it("commits the claim before copying, prevents concurrent duplicate copying and rejects stale dialog attachment", async () => {
    await open();
    let release: () => void = () => {
      throw new Error("Copy barrier not initialized");
    };
    let entered: () => void = () => {
      throw new Error("Copy barrier not initialized");
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    duringCopy = async () => {
      expect((await archives())[0]?.state).toBe("sending");
      entered();
      await gate;
    };
    const first = posts.intake(input("2", { nativeSource: source(7) }));
    try {
      await started;
      await posts.intake(input("2", { nativeSource: source(7) }));
      await open("3");
    } finally {
      release();
      await first;
    }
    expect(calls).toHaveLength(1);
    expect(await templates()).toHaveLength(0);
    expect((await archives())[0]?.state).toBe("ready");
  });
  it("quarantines an expired sending claim instead of retrying a lost acknowledgement", async () => {
    await open();
    result = { kind: "transport_unknown" };
    await posts.intake(input("2", { nativeSource: source(7) }));
    await database
      .updateTable("communication_native_copies")
      .set({
        state: "sending",
        attempted_at: new Date(fixedTestInstant() - 60_001),
      })
      .execute();
    await posts.intake(input("3", { action: "finish", text: "/done" }));
    expect((await archives())[0]?.state).toBe("unknown");
    expect(calls).toHaveLength(1);
  });
  it("retries only a known rejection after its deadline and limits attempts", async () => {
    await open();
    result = {
      kind: "api_retryable",
      providerErrorCode: 429,
      retryAfterSeconds: 5,
    };
    await posts.intake(input("2", { nativeSource: source(7) }));
    await posts.intake(input("3", { action: "finish", text: "/done" }));
    expect(calls).toHaveLength(1);
    for (const id of ["4", "5"]) {
      await database
        .updateTable("communication_native_copies")
        .set({ available_at: new Date(fixedTestInstant() - 1) })
        .execute();
      await sql`truncate telegram_transport_slots`.execute(database);
      await posts.intake(input(id, { action: "finish", text: "/done" }));
    }
    expect(calls).toHaveLength(3);
    expect((await archives())[0]?.state).toBe("rejected");
  });
  it("fails closed on deleted archive copies, forged refs, metadata or album buttons", async () => {
    await open();
    await posts.intake(input("2", { nativeSource: source(7) }));
    const content = required((await templates())[0]).content;
    await expect(
      posts.execute(request(content, "another-author")),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      posts.execute(request({ ...content, nativeRef: randomUUID() })),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      posts.execute(
        request({ ...content, nativeLinks: ["https://hidden.example"] }),
      ),
    ).rejects.toMatchObject({ code: "unsupported_content" });
    result = { kind: "api_rejected", providerErrorCode: 400 };
    expect(await transport.send({ chatId: "84", content })).toEqual(result);
    expect(legacy.send).not.toHaveBeenCalled();
  });
  it.each(["denied", "unavailable"] as const)(
    "does not copy for a currently %s author",
    async (permission) => {
      await open();
      // deterministic-test-allow shared-mutation: The suite's beforeEach restores this synthetic authorization result before every case.
      authorization.result = permission;
      if (permission === "unavailable")
        await expect(
          posts.intake(input("2", { nativeSource: source(7) })),
        ).rejects.toMatchObject({ code: "authorization_unavailable" });
      else await posts.intake(input("2", { nativeSource: source(7) }));
      expect(calls).toHaveLength(0);
      expect(await archives()).toHaveLength(0);
      expect(await templates()).toHaveLength(0);
    },
  );
  it("preserves copy IDs through reconstruction and refuses destructive migration rollback", async () => {
    await open();
    await posts.intake(input("2", { nativeSource: source(7) }));
    await expect(
      database.transaction().execute(async (tx) => {
        await nativeMessageCopiesMigration.down?.(tx);
      }),
    ).rejects.toThrow("Native copies exist");
    const saved = required((await templates())[0]);
    const restarted = new NativeMessages(
      database,
      config,
      authorization,
      copy,
      clock,
    );
    expect(await restarted.resolve(saved.content, "84")).toMatchObject({
      sourceChatId: "42",
      messageIds: [501],
    });
    expect((await archives())[0]?.state).toBe("ready");
  });
  it("checks native ownership in broadcast, intro and sequence saves", async () => {
    await open();
    await posts.intake(input("2", { nativeSource: source(7) }));
    const content = required((await templates())[0]).content;
    for (const payload of [
      { parts: [{ partId: randomUUID(), content }] },
      {
        entryResponse: {
          stepId: randomUUID(),
          parts: [{ partId: randomUUID(), content }],
        },
      },
      {
        steps: [
          {
            stepId: randomUUID(),
            delaySeconds: 0,
            parts: [{ partId: randomUUID(), content }],
          },
        ],
      },
    ]) {
      await expect(
        sequences.execute({
          ...request(content, "another-author"),
          operation: "broadcasts.save",
          payload,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    }
  });
  it("deduplicates native ownership reads and records canonical provider metadata", async () => {
    await open();
    const port = new GrammyNativeMessageArchive({
      forwardMessage: vi.fn().mockResolvedValue({
        message_id: 501,
        chat: { id: 42, type: "private" },
        text: "Changed https://inside.example/materials/private",
      }),
      sendMediaGroup: vi.fn(),
    });
    const actualNative = new NativeMessages(
      database,
      config,
      authorization,
      port,
      clock,
    );
    const actualPosts = new Communications(
      database,
      config,
      authorization,
      actualNative,
    );
    await actualPosts.intake(input("2", { nativeSource: source(7) }));
    const content = required((await templates())[0]).content;
    expect(content.nativeLinks).toEqual([
      "https://inside.example/materials/private",
    ]);
    await database.transaction().execute(async (tx) => {
      const reads = vi.spyOn(tx, "selectFrom");
      await actualNative.assertOwned(
        tx,
        "synthetic-author",
        Array.from({ length: 100 }, (_value, index) =>
          index % 2 === 0
            ? content
            : {
                ...content,
                nativeRef: required(content.nativeRef).toUpperCase(),
              },
        ),
      );
      expect(
        reads.mock.calls.filter(
          ([table]) => table === "communication_native_copies",
        ),
      ).toHaveLength(1);
    });
  });
  it("does not reopen an already finalized media group in another author context", async () => {
    await open();
    await posts.intake(input("2", { nativeSource: source(7, "album") }));
    await posts.intake(input("3", { nativeSource: source(8, "album") }));
    result = { kind: "delivered", messageIds: [501, 502] };
    await posts.intake(input("4", { action: "finish", text: "/done" }));
    await open("5");
    await posts.intake(input("6", { nativeSource: source(9, "album") }));
    await posts.intake(input("7", { action: "finish", text: "/done" }));
    expect(calls).toHaveLength(1);
    expect(await templates()).toHaveLength(1);
    expect(await archives()).toHaveLength(1);
  });
  it("replaces a post with buttons by an album and reminds the author which copies to keep", async () => {
    const legacyPost = await posts.execute(
      request({
        type: "text",
        text: "Old",
        entities: [],
        buttons: [{ text: "Open", url: "https://inside.example" }],
      }),
    );
    await database
      .insertInto("communication_author_sessions")
      .values({
        bot_identity: "inside",
        telegram_user_id: "42",
        account_ref: "synthetic-author",
        state: JSON.stringify({
          ...emptyAuthorState(randomUUID()),
          template: legacyPost,
          prompt: { kind: "replace" },
        }),
      })
      .execute();
    await admin.handle({
      ...identity,
      updateId: "2",
      text: "",
      content: null,
      nativeSource: source(7, "album"),
    });
    await admin.handle({
      ...identity,
      updateId: "3",
      text: "",
      content: null,
      nativeSource: source(8, "album"),
    });
    result = { kind: "delivered", messageIds: [501, 502] };
    await admin.handle({
      ...identity,
      updateId: "4",
      text: "/done",
      content: null,
    });
    expect(required((await templates())[0]).content).toMatchObject({
      type: "native",
      nativeCount: 2,
      buttons: [],
    });
    const reminder = await database
      .selectFrom("start_response_deliveries")
      .select("message_text")
      .where("source_key", "=", "native-copy-kept:inside:4")
      .executeTakeFirst();
    expect(reminder?.message_text).toContain("Оставьте первую копию");
  });
  it("rejects the whole album when a later part has a caption over the accepted limit", async () => {
    await open();
    await posts.intake(input("2", { nativeSource: source(7, "album") }));
    await posts.intake(
      input("3", {
        nativeSource: {
          ...source(8, "album"),
          rejection: "album_caption_too_long",
        },
      }),
    );
    await posts.intake(input("4", { action: "finish", text: "/done" }));
    expect(calls).toHaveLength(0);
    expect(await templates()).toHaveLength(0);
    expect((await archives())[0]).toMatchObject({
      state: "rejected",
      diagnostic_code: "album_caption_too_long",
    });
    const reply = await database
      .selectFrom("start_response_deliveries")
      .select("message_text")
      .where("source_key", "=", "native-capture:inside:3")
      .executeTakeFirst();
    expect(reply?.message_text).toContain("подпись длиннее 1024");
  });
  it("captures native content from the author replacement dialog through the same archive", async () => {
    const legacyPost = await posts.execute(
      request({ type: "text", text: "Old", entities: [], buttons: [] }),
    );
    const state = {
      ...emptyAuthorState(randomUUID()),
      template: legacyPost,
      prompt: { kind: "replace" },
    };
    await database
      .insertInto("communication_author_sessions")
      .values({
        ...{
          bot_identity: "inside",
          telegram_user_id: "42",
          account_ref: "synthetic-author",
        },
        state: JSON.stringify(state),
      })
      .execute();
    await admin.handle({
      ...identity,
      updateId: "2",
      text: "",
      content: null,
      nativeSource: source(7),
    });
    expect(calls).toHaveLength(1);
    expect(required((await templates())[0]).content.type).toBe("native");
  });
});
