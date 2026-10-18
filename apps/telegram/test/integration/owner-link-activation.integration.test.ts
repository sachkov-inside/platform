import { fixedTestInstant } from "../support/fixed-clock.js";
import { isTruthy } from "../../src/shared/truthiness.js";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AppModule } from "../../src/app.module.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { DATABASE, type Database } from "../../src/database/database.js";
import { CLOCK } from "../../src/shared/clock.js";
import { SourceGroupProof } from "../../src/modules/subscription-activation/source-group-proof.js";
import {
  ACTIVATION_PLATFORM,
  type ActivationPlatform,
} from "../../src/modules/subscription-activation/activation-ports.js";
import {
  ACTIVATION_VERSION,
  type ActivationBinding,
  type ActivationEvidence,
  type ActivationResponse,
  type ActivationResult,
} from "../../src/modules/subscription-activation/activation-contract.js";
import { ActivationReviews } from "../../src/modules/subscription-activation/activation-reviews.js";
import { announceActivation } from "../../src/modules/subscription-activation/activation-announcement.js";
import { OWNER_REVIEW } from "../../src/modules/subscription-activation/activation-view.js";
import { reserveTelegramIdentity } from "../../src/modules/identity-linking/stable-telegram-identity.js";
import { SubscriptionActivation } from "../../src/modules/subscription-activation/subscription-activation.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { privateStartUpdate } from "../support/synthetic-telegram-updates.js";
import { required } from "../support/required.js";

// The Platform double below grants by a simple table so the consumer's checks, messages and
// review queue can be observed. It does not prove Platform's own rule or grant policy.
const bot = `owner-link-${randomUUID()}`;
const canonicalChatId = "-1000000000000";
const courseChatId = "-1000000000001";
const clock = {
  value: new Date(fixedTestInstant()),
  now() {
    return new Date(this.value);
  },
};
const config = loadApplicationConfig({
  DATABASE_URL: process.env["DATABASE_URL"],
  TELEGRAM_BOT_IDENTITY: bot,
  TELEGRAM_CANONICAL_CHAT_ID: canonicalChatId,
  TELEGRAM_WEBHOOK_SECRET: "synthetic-owner-link-webhook-secret",
  PLATFORM_INTEGRATION_SECRET: "synthetic-link-secret-for-tests-only",
  TELEGRAM_LINK_RECEIPT_TEXT: "Link receipt",
  TELEGRAM_LINKED_MEMBER_TEXT: "member",
  TELEGRAM_LINKED_NON_MEMBER_TEXT: "not member",
  TELEGRAM_LINKED_UNAVAILABLE_TEXT: "unavailable",
  TELEGRAM_WELCOME_TEXT: "Welcome",
  WORKERS_ENABLED: "false",
  TELEGRAM_ACTIVATION_ENABLED: "true",
  PLATFORM_ACTIVATION_SECRET: "k".repeat(32),
  PLATFORM_ACTIVATION_URL: "http://127.0.0.1:1/activation",
  PLATFORM_ACCOUNT_URL: "https://platform.example/account",
  TELEGRAM_ACTIVATION_SOURCES: JSON.stringify([
    { sourceRef: "course", chatId: courseChatId, policy: "whole_group" },
  ]),
});
const rules = {
  second: {
    id: randomUUID(),
    revision: 1,
    sourceRef: "course",
    verificationMode: "course_membership" as const,
    product: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "ai-engineering",
      name: "AI Engineering",
    },
  },
  course: {
    id: randomUUID(),
    revision: 1,
    sourceRef: "course",
    verificationMode: "course_membership" as const,
    product: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "ai-engineering",
      name: "AI Engineering",
    },
  },
};
type Code = keyof typeof rules;
const bindings = new Map<string, ActivationBinding>();
/** Chat members by `${chatId}:${userId}`; the canonical chat is listed to prove it is ignored. */
const members = new Set<string>();
/** Rules the owner paused on Platform. */
const paused = new Set<string>();
const unavailable = new Set<string>();
const explicitUnavailable = new Set<string>();
const begins: string[] = [];
const proofs: ActivationEvidence[] = [];
const memberLookups: string[] = [];
const grants = new Map<string, number>();
const attemptResults = new Map<string, ActivationResult<ActivationResponse>>();
const platform: ActivationPlatform = {
  redeem: () => Promise.resolve(undefined),
  binding(identityRef) {
    const binding = bindings.get(identityRef);
    return Promise.resolve({
      ok: true,
      value: {
        contractVersion: ACTIVATION_VERSION,
        ...(binding ? { state: "linked", binding } : { state: "unlinked" }),
      },
    });
  },
  begin(input) {
    begins.push(input.code);
    if (unavailable.has(input.code)) return Promise.resolve(undefined);
    if (explicitUnavailable.has(input.code))
      return Promise.resolve({ ok: false, error: { code: "unavailable" } });
    const code = Object.keys(rules).find(
      (key): key is Code => key === input.code,
    );
    if (code === undefined)
      return Promise.resolve({ ok: false, error: { code: "not_found" } });
    if (paused.has(code))
      return Promise.resolve({ ok: false, error: { code: "policy_paused" } });
    const prior = attemptResults.get(input.attemptId);
    if (prior) return Promise.resolve(structuredClone(prior));
    return Promise.resolve({
      ok: true,
      value: {
        contractVersion: ACTIVATION_VERSION,
        attemptId: input.attemptId,
        state: "checking",
        enrollment: null,
        rule: rules[code],
      },
    });
  },
  evidence(input) {
    proofs.push(structuredClone(input));
    // Platform returns the saved result for an already completed attempt.
    const replay = attemptResults.get(input.attemptId);
    if (replay) return Promise.resolve(structuredClone(replay));
    const confirmed = input.decision === "member";
    const key = `${input.sourceRef}:${input.identityRef}`;
    const prior = grants.get(key) ?? 0;
    if (confirmed && prior === 0) grants.set(key, 1);
    const result: ActivationResult<ActivationResponse> = {
      ok: true,
      value: {
        contractVersion: ACTIVATION_VERSION,
        attemptId: input.attemptId,
        state: confirmed
          ? isTruthy(prior)
            ? "already_active"
            : "active"
          : "rejected",
        enrollment: confirmed
          ? {
              id: `enrollment-${input.identityRef}`,
              tier: {
                name: "AI Engineering",
                benefits: ["community", "support"],
              },
              origin: "course",
              startsAt: clock.now().toISOString(),
              endsAt: null,
              state: "active",
              renewal: "not_applicable",
            }
          : null,
      },
    };
    attemptResults.set(input.attemptId, structuredClone(result));
    return Promise.resolve(result);
  },
  own() {
    return Promise.resolve({
      ok: true,
      value: {
        contractVersion: ACTIVATION_VERSION,
        products: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            slug: "ai-engineering",
            name: "AI Engineering",
            programmeUrl:
              "https://sachkov.dev/products/ai-engineering/programme",
            materials: { state: "available" },
            community: { state: "available" },
          },
        ],
        enrollments: [],
        grounds: [],
        admission: { state: "no_access", admissionRestriction: "none" },
      },
    });
  },
};
let app: NestFastifyApplication;
let db: Database;
let worker: SubscriptionActivation;
let reviews: ActivationReviews;
let updateId = 820000;
let nextUser = 820000;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(ACTIVATION_PLATFORM)
    .useValue(platform)
    .overrideProvider(SourceGroupProof)
    .useValue(
      new SourceGroupProof(required(config.activation).sources, {
        getBotChatMember() {
          return Promise.resolve({
            kind: "observed",
            value: { status: "administrator" },
          });
        },
        getChatMember(chatId, userId) {
          memberLookups.push(chatId);
          return Promise.resolve({
            kind: "observed",
            value: {
              status: members.has(`${chatId}:${userId}`) ? "member" : "left",
            },
          });
        },
      }),
    )
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = app.get(DATABASE);
  worker = app.get(SubscriptionActivation);
  reviews = new ActivationReviews(db, clock);
});
beforeEach(() => {
  begins.length = 0;
  proofs.length = 0;
  memberLookups.length = 0;
  unavailable.clear();
  explicitUnavailable.clear();
  clock.value = new Date(clock.now().getTime() + 61_000);
});
afterAll(async () => {
  await db
    .deleteFrom("activation_review_requests")
    .where("bot_identity", "=", bot)
    .execute();
  await app.close();
});

async function send(
  user: number,
  text = "/start",
  chat?: { id: number; type: string },
) {
  const update = privateStartUpdate(++updateId, user, { text });
  const payload = chat
    ? { ...update, message: { ...update.message, chat } }
    : update;
  const response = await app.inject({
    method: "POST",
    url: "/webhooks/telegram",
    headers: { "x-telegram-bot-api-secret-token": config.webhookSecret },
    payload,
  });
  expect(response.statusCode).toBe(202);
  await app.get(TelegramUpdateProcessor).processAvailable();
}
/** A person who started the bot once and then linked the Account on Platform. */
async function linkedPerson() {
  const user = ++nextUser;
  await send(user);
  // Linking on Platform reserves the stable identity; an ordinary /start does not.
  const ref = await db
    .transaction()
    .execute((tx) => reserveTelegramIdentity(tx, bot, String(user)));
  bindings.set(ref, {
    accountRef: `account-${user}`,
    identityRef: ref,
    linkRef: randomUUID(),
    linkRevision: 1,
  });
  return { user, identityRef: ref };
}
async function drain() {
  for (let round = 0; round < 3; round++) await worker.processAvailable();
}
function deferred() {
  let signal: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    signal = resolve;
  });
  return { promise, resolve: () => required(signal)() };
}
function activationMessages(user: number) {
  return db
    .selectFrom("start_response_deliveries")
    .select(["message_text", "buttons"])
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "=", String(user))
    .where("source_key", "like", "activation%")
    .orderBy("id")
    .execute();
}
async function openReviews(user: number) {
  return (await reviews.open()).filter(
    (review) =>
      review.botIdentity === bot && review.telegramUserId === String(user),
  );
}

function attempts(user: number) {
  return db
    .selectFrom("activation_attempts")
    .select(["code", "state"])
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "=", String(user))
    .orderBy("code")
    .execute();
}
/** The `/start` a member sends after pressing the owner's button in the course group. */
async function pressButton(code: string) {
  const result = await announceActivation(
    {
      activation: config.activation,
      sourceRef: "course",
      productId: "course-product",
      text: "Текст владельца",
      privateChatId: "1234",
      operationId: "preview",
      code,
      send: false,
    },
    {
      botUsername: () => Promise.resolve("inside_test_bot"),
      privateChat: () => Promise.resolve(true),
      sendText: () => Promise.reject(new Error("A preview sends nothing")),
    },
    {
      resolve: () =>
        Promise.resolve({
          sourceRef: "course",
          productId: "course-product",
        }),
    },
    {
      claim: () => {
        throw new Error("Preview claims nothing");
      },
      complete: () => Promise.resolve(),
    },
  );
  if (result.status !== "ready") throw new Error(result.status);
  const url = new URL(required(result.button.url));
  expect(`${url.origin}${url.pathname}`).toBe("https://t.me/inside_test_bot");
  return `/start ${required(url.searchParams.get("start"))}`;
}

describe("ordinary /start", () => {
  it("checks nothing, grants nothing and queues nobody, even for a linked course member", async () => {
    const person = await linkedPerson();
    members.add(`${courseChatId}:${person.user}`);
    await send(person.user);
    await send(person.user);
    await drain();
    expect(begins).toEqual([]);
    expect(proofs).toEqual([]);
    expect(memberLookups).toEqual([]);
    expect(await attempts(person.user)).toEqual([]);
    expect(await activationMessages(person.user)).toEqual([]);
    expect(await openReviews(person.user)).toEqual([]);
    expect(grants.has(`course:${person.identityRef}`)).toBe(false);
    // The person gets the ordinary greeting instead.
    const texts = await db
      .selectFrom("start_response_deliveries")
      .select("message_text")
      .where("bot_identity", "=", bot)
      .where("telegram_user_id", "=", String(person.user))
      .execute();
    expect(texts.map((row) => row.message_text)).toContain(
      "Мои продукты\n\nВыберите продукт, чтобы открыть материалы или группу.",
    );
  });
});

describe("the owner's button in the course group", () => {
  it("does not duplicate the unavailable reply that Platform explicitly returned", async () => {
    const person = await linkedPerson();
    explicitUnavailable.add("course");
    try {
      await send(person.user, "/start a_course");
      const messages = await db
        .selectFrom("start_response_deliveries")
        .select("message_text")
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", String(person.user))
        .where((eb) =>
          eb.or([
            eb("source_key", "like", "access:%"),
            eb("source_key", "like", "activation:%"),
          ]),
        )
        .execute();
      expect(
        messages.filter((message) =>
          message.message_text.includes("Не удалось проверить доступ"),
        ),
      ).toHaveLength(1);
    } finally {
      explicitUnavailable.clear();
      await db
        .deleteFrom("activation_attempts")
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", String(person.user))
        .execute();
    }
  });

  it("keeps the chosen rule when the learner presses its retry button", async () => {
    const person = await linkedPerson();
    await send(person.user, "/start a_course");
    await send(person.user, "/start a_second");
    const messages = await activationMessages(person.user);
    const retry = required(messages[0]).buttons?.find(
      (button) => button.text === "Проверить ещё раз",
    );
    expect(retry?.callbackData).toBe("access:retry:course");
    begins.length = 0;
    members.add(`${courseChatId}:${person.user}`);
    const id = ++updateId;
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": config.webhookSecret },
      payload: {
        update_id: id,
        callback_query: {
          id: String(id),
          data: retry?.callbackData,
          from: { id: person.user, is_bot: false },
          message: {
            message_id: id,
            chat: { id: person.user, type: "private" },
          },
        },
      },
    });
    expect(response.statusCode).toBe(202);
    await app.get(TelegramUpdateProcessor).processAvailable();
    expect(begins).toEqual(["course"]);
    expect(await attempts(person.user)).toEqual([
      { code: "course", state: "completed" },
      { code: "second", state: "rejected" },
    ]);
    expect(grants.get(`course:${person.identityRef}`)).toBe(1);
  });

  it("returns a truthful failure when the immediate provider check is unavailable", async () => {
    const person = await linkedPerson();
    members.add(`${courseChatId}:${person.user}`);
    unavailable.add("course");
    try {
      await send(person.user, "/start a_course");
      const messages = await db
        .selectFrom("start_response_deliveries")
        .select("message_text")
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", String(person.user))
        .where("source_key", "like", "access:%")
        .execute();
      expect(
        messages.filter((message) =>
          message.message_text.includes("Не удалось проверить доступ"),
        ),
      ).toHaveLength(1);
      expect(grants.has(`course:${person.identityRef}`)).toBe(false);
      expect(await attempts(person.user)).toEqual([
        { code: "course", state: "retry" },
      ]);
    } finally {
      unavailable.clear();
      clock.value = new Date(clock.now().getTime() + 61_000);
      await drain();
    }
  });

  it("does not process another learner while checking the selected learner", async () => {
    const other = ++nextUser;
    await send(other, "/start a_course");
    try {
      begins.length = 0;
      const person = await linkedPerson();
      members.add(`${courseChatId}:${person.user}`);
      await send(person.user, "/start a_course");
      expect(begins).toEqual(["course"]);
      expect(await attempts(other)).toEqual([
        { code: "course", state: "rejected" },
      ]);
      expect(grants.get(`course:${person.identityRef}`)).toBe(1);
    } finally {
      await db
        .deleteFrom("activation_attempts")
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", String(other))
        .execute();
    }
  });

  it("checks the selected learner immediately without a scheduling acknowledgement", async () => {
    const person = await linkedPerson();
    members.add(`${courseChatId}:${person.user}`);
    await send(person.user, "/start a_course");
    expect(grants.get(`course:${person.identityRef}`)).toBe(1);
    expect(await attempts(person.user)).toEqual([
      { code: "course", state: "completed" },
    ]);
    const messages = await db
      .selectFrom("start_response_deliveries")
      .select("message_text")
      .where("bot_identity", "=", bot)
      .where("telegram_user_id", "=", String(person.user))
      .where((eb) =>
        eb.or([
          eb("source_key", "like", "access:%"),
          eb("source_key", "like", "activation:%"),
        ]),
      )
      .execute();
    expect(
      messages.filter((message) =>
        message.message_text.includes("Курс доступен"),
      ),
    ).toHaveLength(1);
    expect(
      messages.every(
        (message) => !message.message_text.includes("запланирована"),
      ),
    ).toBe(true);
  });

  it("leads a group member to rights and the community invitation", async () => {
    const person = await linkedPerson();
    members.add(`${courseChatId}:${person.user}`);
    const start = await pressButton("course");
    expect(start).toBe("/start a_course");
    await send(person.user, start);
    await drain();
    expect(begins).toEqual(["course"]);
    expect(memberLookups).toEqual([courseChatId]);
    expect(grants.get(`course:${person.identityRef}`)).toBe(1);
    const [message] = await activationMessages(person.user);
    expect(required(message).message_text).toContain("Курс доступен");
    expect(
      required(message).buttons?.some(
        (button) => button.text === "Вступить в группу",
      ),
    ).toBe(true);
    expect(await openReviews(person.user)).toEqual([]);
    // Pressing again confirms the same right: no second grant, attempt or review.
    await send(person.user, start);
    await drain();
    expect(grants.get(`course:${person.identityRef}`)).toBe(1);
    expect(await attempts(person.user)).toEqual([
      { code: "course", state: "completed" },
    ]);
    expect(await openReviews(person.user)).toEqual([]);
    expect(await activationMessages(person.user)).toHaveLength(2);
    await app.inject({
      method: "POST",
      url: "/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": config.webhookSecret },
      payload: privateStartUpdate(updateId, person.user, { text: start }),
    });
    await app.get(TelegramUpdateProcessor).processAvailable();
    await drain();
    expect(await activationMessages(person.user)).toHaveLength(2);
    expect(grants.get(`course:${person.identityRef}`)).toBe(1);
  });

  it("answers the latest request when another worker already holds the activation lease", async () => {
    const person = await linkedPerson();
    members.add(`${courseChatId}:${person.user}`);
    const start = await pressButton("course");
    unavailable.add("course");
    await send(person.user, start);
    unavailable.delete("course");
    clock.value = new Date(clock.now().getTime() + 61_000);
    const entered = deferred();
    const release = deferred();
    const begin = platform.begin.bind(platform);
    const spy = vi
      .spyOn(platform, "begin")
      .mockImplementationOnce(async (input) => {
        entered.resolve();
        await release.promise;
        return begin(input);
      });
    const first = worker.processAvailable(1, {
      telegramUserId: String(person.user),
      code: "course",
    });
    try {
      await entered.promise;
      const leased = required(
        await db
          .selectFrom("activation_attempts")
          .select(["lease_token", "attempts"])
          .where("bot_identity", "=", bot)
          .where("telegram_user_id", "=", String(person.user))
          .executeTakeFirst(),
      );
      await send(person.user, start);
      const latestUpdate = String(updateId);
      expect(
        await db
          .selectFrom("activation_attempts")
          .select(["lease_token", "attempts"])
          .where("bot_identity", "=", bot)
          .where("telegram_user_id", "=", String(person.user))
          .executeTakeFirst(),
      ).toEqual(leased);
      expect(await activationMessages(person.user)).toEqual([]);
      release.resolve();
      await first;
      const replies = await db
        .selectFrom("start_response_deliveries")
        .select("trigger_update_id")
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", String(person.user))
        .where("source_key", "like", "activation:%")
        .execute();
      expect(replies).toEqual([{ trigger_update_id: latestUpdate }]);
      expect(grants.get(`course:${person.identityRef}`)).toBe(1);
    } finally {
      release.resolve();
      await first;
      spy.mockRestore();
    }
  });

  it("answers a non-member and queues one owner review however often they press", async () => {
    const person = await linkedPerson();
    const start = await pressButton("course");
    await send(person.user, start);
    await drain();
    const messages = await activationMessages(person.user);
    expect(messages).toHaveLength(1);
    expect(required(messages[0]).message_text).toContain(
      "Не удалось подтвердить ваше участие",
    );
    // One instruction: the person writes to the author; the owner still gets the review.
    expect(required(messages[0]).buttons).toContainEqual({
      text: "Помощь",
      callbackData: "access:help",
    });
    expect(required(messages[0]).message_text).not.toContain(OWNER_REVIEW);
    const [review] = await openReviews(person.user);
    expect(review).toMatchObject({
      identityRef: person.identityRef,
      accountRef: `account-${person.user}`,
      outcomes: [{ code: "course", outcome: "rejected" }],
    });
    await send(person.user, start);
    await drain();
    expect(await openReviews(person.user)).toHaveLength(1);
    expect(grants.has(`course:${person.identityRef}`)).toBe(false);
    expect(await reviews.resolve(required(review).reviewId)).toBe("resolved");
    expect(await openReviews(person.user)).toEqual([]);
    expect(await reviews.resolve(required(review).reviewId)).toBe("not_found");
  });

  it("resolves the owner review when the person joins the group and presses again", async () => {
    const person = await linkedPerson();
    const start = await pressButton("course");
    await send(person.user, start);
    await drain();
    expect(await openReviews(person.user)).toHaveLength(1);
    members.add(`${courseChatId}:${person.user}`);
    await send(person.user, start);
    await drain();
    expect(grants.get(`course:${person.identityRef}`)).toBe(1);
    expect(await openReviews(person.user)).toEqual([]);
    expect(
      (await activationMessages(person.user)).at(-1)?.message_text,
    ).toContain("Курс доступен");
  });

  it("never accepts the canonical community chat as a ground", async () => {
    const person = await linkedPerson();
    members.add(`${canonicalChatId}:${person.user}`);
    await send(person.user, await pressButton("course"));
    await drain();
    expect(memberLookups).toEqual([courseChatId]);
    expect(grants.has(`course:${person.identityRef}`)).toBe(false);
    expect(await openReviews(person.user)).toHaveLength(1);
  });
});

describe("the owner link", () => {
  it("does not start from the community chat", async () => {
    const person = await linkedPerson();
    members.add(`${courseChatId}:${person.user}`);
    await send(person.user, "/start a_course", {
      id: Number(canonicalChatId),
      type: "supergroup",
    });
    await drain();
    expect(begins).toEqual([]);
    expect(await attempts(person.user)).toEqual([]);
  });

  it("rejects the retired Tribute code without rights", async () => {
    const person = await linkedPerson();
    const previousGrants = grants.size;
    await send(person.user, "/start a_tribute");
    await worker.processAvailable();
    expect(proofs).toEqual([]);
    expect(grants.size).toBe(previousGrants);
    expect(grants.has(`course:${person.identityRef}`)).toBe(false);
  });
  it("ends an expired retry of a confirmed ground as confirmed", async () => {
    const person = await linkedPerson();
    members.add(`${courseChatId}:${person.user}`);
    await send(person.user, "/start a_course");
    await drain();
    // A retry of the confirmed ground kept failing until its retention ran out.
    await db
      .updateTable("activation_attempts")
      .set({
        state: "retry",
        result: { ok: false, error: { code: "unavailable" } },
        expires_at: clock.now(),
        due_at: clock.now(),
      })
      .where("bot_identity", "=", bot)
      .where("telegram_user_id", "=", String(person.user))
      .where("code", "=", "course")
      .execute();
    begins.length = 0;
    unavailable.clear();
    clock.value = new Date(clock.now().getTime() + 61_000);
    await drain();
    expect(begins).toEqual([]);
    const kept = await db
      .selectFrom("activation_attempts")
      .select(["state", "confirmed_at"])
      .where("bot_identity", "=", bot)
      .where("telegram_user_id", "=", String(person.user))
      .where("code", "=", "course")
      .executeTakeFirstOrThrow();
    expect(kept.state).toBe("completed");
    expect(kept.confirmed_at).toBeInstanceOf(Date);
  });

  it("answers a link to an unknown or paused rule without queueing an owner review", async () => {
    const person = await linkedPerson();
    await send(person.user, "/start a_typo");
    await drain();
    paused.add("course");
    try {
      await send(person.user, "/start a_course");
      await drain();
    } finally {
      paused.clear();
    }
    const messages = await activationMessages(person.user);
    expect(required(messages[0]).message_text).toBe(
      "Получение доступа по этой ссылке сейчас недоступно.",
    );
    expect(messages).toHaveLength(2);
    expect(await openReviews(person.user)).toEqual([]);
  });
});
