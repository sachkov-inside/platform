import {AUTHOR_AUTHORIZATION} from "../../src/modules/communications/author-authorization.js";
import { fixedTestInstant } from "../support/fixed-clock.js";
import { createHash, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { describe, expect, test, vi } from "vitest";
import {TELEGRAM_MESSAGES,type TelegramTextMessage,type TelegramMessageEdit} from "../../src/modules/outbound/telegram-messages.js";
import {StartResponseDeliveryProcessor} from "../../src/modules/outbound/start-response-delivery-processor.js";
import { AppModule } from "../../src/app.module.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { DATABASE, type Database } from "../../src/database/database.js";
import { CLOCK } from "../../src/shared/clock.js";
import { IdentityLinking } from "../../src/modules/identity-linking/identity-linking.js";
import { SourceGroupProof } from "../../src/modules/subscription-activation/source-group-proof.js";
import {
  ACTIVATION_PLATFORM,
  type ActivationPlatform,
} from "../../src/modules/subscription-activation/activation-ports.js";
import {
  ACTIVATION_VERSION,
  type OwnAccess,
  type ActivationBinding,
  type ActivationEvidence,
  type ActivationResponse,
  type ActivationResult,
} from "../../src/modules/subscription-activation/activation-contract.js";
import { SubscriptionActivation } from "../../src/modules/subscription-activation/subscription-activation.js";
import { TelegramUpdateProcessor } from "../../src/modules/update-inbox/telegram-update-processor.js";
import { privateStartUpdate } from "../support/synthetic-telegram-updates.js";
import { StartResponseDeliveryQueue } from "../../src/modules/outbound/start-response-delivery-queue.js";
import { required } from "../support/required.js";

const it = test.extend<{
  activation: Awaited<ReturnType<typeof createFixture>>;
}>({
  activation: async ({ signal }, use) => {
    signal.throwIfAborted();
    const fixture = await createFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.app.close();
    }
  },
});

async function createFixture() {
  const bot = `activation-${randomUUID()}`;
  const clock = {
    value: new Date(fixedTestInstant()),
    now() {
      return new Date(this.value);
    },
  };
  const config = loadApplicationConfig({
    DATABASE_URL: process.env["DATABASE_URL"],
    TELEGRAM_BOT_IDENTITY: bot,
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_WEBHOOK_SECRET: "synthetic-webhook-secret-for-tests-only",
    PLATFORM_INTEGRATION_SECRET: "synthetic-link-secret-for-tests-only",
    TELEGRAM_LINK_RECEIPT_TEXT: "Link receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "not member",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "unavailable",
    TELEGRAM_WELCOME_TEXT: "Welcome",
    WORKERS_ENABLED: "false",
    TELEGRAM_ACTIVATION_ENABLED: "true",
    PLATFORM_ACTIVATION_SECRET: "s".repeat(32),
    PLATFORM_ACTIVATION_URL: "http://127.0.0.1:1/activation",
    PLATFORM_ACCOUNT_URL: "https://platform.example/account",
    TELEGRAM_ACTIVATION_SOURCES: JSON.stringify([
      { sourceRef: "course", chatId: "-1000000000001", policy: "whole_group" },
    ]),
  });
  const bindings = new Map<string, ActivationBinding>();
  const proofs: ActivationEvidence[] = [];
  const begins: string[] = [];
  const granted = new Set<string>();
  const results = new Map<string, ActivationResult<ActivationResponse>>();
  const receipts = new Map<string, ActivationResult<ActivationResponse>>();
  const state = {
    loseResponse: false,
    dropBeforeAccept: false,
    evidenceConflict: false,
    onSourceCheck: undefined as (() => Promise<void>) | undefined,
    source: "member" as "member" | "not_member" | "unavailable",
    bindingUnavailable: false,
    author:"denied" as "allowed"|"denied"|"unavailable",
    editRejected:false,
    onOwn:undefined as (()=>Promise<void>)|undefined,
    products: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "ai-engineering",
        name: "AI Engineering",
        programmeUrl: "https://sachkov.dev/products/ai-engineering/programme",
        materials: { state: "available" as const },
        community: { state: "available" as const },
      },
    ] as NonNullable<OwnAccess["products"]>,
  };
  const rule = { id: randomUUID(), revision: 1, sourceRef: "course",product:{id:"11111111-1111-4111-8111-111111111111",slug:"ai-engineering",name:"AI Engineering"} };
  const platform: ActivationPlatform = {
    redeem: () => Promise.resolve(undefined),
    binding(identityRef) {
      return Promise.resolve(
        state.bindingUnavailable
          ? { ok: false, error: { code: "unavailable" } }
          : {
              ok: true,
              value: {
                contractVersion: ACTIVATION_VERSION,
                ...(bindings.has(identityRef)
                  ? {
                      state: "linked",
                      binding: required(bindings.get(identityRef)),
                    }
                  : { state: "unlinked" }),
              },
            },
      );
    },
    begin(input) {
      begins.push(input.attemptId);
      if (results.has(input.attemptId))
        return Promise.resolve(
          structuredClone(required(results.get(input.attemptId))),
        );
      return Promise.resolve({
        ok: true,
        value: {
          contractVersion: ACTIVATION_VERSION,
          attemptId: input.attemptId,
          state: "needs_account",
          enrollment: null,
          rule,
        },
      });
    },
    evidence(input) {
      proofs.push(structuredClone(input));
      if (state.dropBeforeAccept) {
        state.dropBeforeAccept = false;
        return Promise.resolve(undefined);
      }
      if (state.evidenceConflict)
        return Promise.resolve({
          ok: false,
          error: { code: "identity_conflict" },
        });
      if (receipts.has(input.evidenceRef))
        return Promise.resolve(
          structuredClone(required(receipts.get(input.evidenceRef))),
        );
      if (Date.parse(input.validUntil) <= clock.now().getTime())
        return Promise.resolve({
          ok: false,
          error: { code: "source_not_confirmed" },
        });
      if (input.decision === "member")
        granted.add(`${input.sourceRef}:${input.identityRef}`);
      const result: ActivationResult<ActivationResponse> = {
        ok: true,
        value: {
          contractVersion: ACTIVATION_VERSION,
          attemptId: input.attemptId,
          state:
            input.decision === "member"
              ? "active"
              : input.decision === "not_member"
                ? "rejected"
                : "unavailable",
          enrollment: null,
        },
      };
      results.set(input.attemptId, structuredClone(result));
      receipts.set(input.evidenceRef, structuredClone(result));
      if (state.loseResponse) {
        state.loseResponse = false;
        return Promise.resolve(undefined);
      }
      return Promise.resolve(result);
    },
    async own() {
      await state.onOwn?.();
      return {
        ok: true,
        value: {
          contractVersion: ACTIVATION_VERSION,
          products: state.products,
          enrollments: [],
          grounds: [],
          admission: { state: "no_access", admissionRestriction: "none" },
        },
      };
    },
  };

  const sent:TelegramTextMessage[] = [];
  const edited:TelegramMessageEdit[] = [];
  const module = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(AUTHOR_AUTHORIZATION).useValue({authorize:()=>Promise.resolve(state.author)})
    .overrideProvider(TELEGRAM_MESSAGES).useValue({
      sendText(message:TelegramTextMessage){sent.push(message);return Promise.resolve({kind:"delivered",providerMessageId:String(sent.length)});},
      editText(message:TelegramMessageEdit){edited.push(message);return Promise.resolve(state.editRejected ? {kind:"api_rejected",providerErrorCode:400} : {kind:"delivered",providerMessageId:message.messageId});},
    })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(ACTIVATION_PLATFORM)
    .useValue(platform)
    .overrideProvider(SourceGroupProof)
    .useValue({
      async check() {
        const hook = state.onSourceCheck;
        state.onSourceCheck = undefined;
        if (hook) await hook();
        return { decision: state.source };
      },
    })
    .compile();
  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  } catch (error) {
    await app.close();
    throw error;
  }
  const db = app.get<Database>(DATABASE);
  const worker = app.get(SubscriptionActivation);
  let updateId = 300000;
  async function ingress(user: number, text: string) {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/telegram",
      headers: { "x-telegram-bot-api-secret-token": config.webhookSecret },
      payload: privateStartUpdate(++updateId, user, { text }),
    });
    expect(response.statusCode).toBe(202);
    await app.get(TelegramUpdateProcessor).processAvailable();
  }
  async function callback(user:number,data:string,messageId=42) {
    const id=++updateId;
    const response=await app.inject({method:"POST",url:"/webhooks/telegram",headers:{"x-telegram-bot-api-secret-token":config.webhookSecret},payload:{update_id:id,callback_query:{id:String(id),data,from:{id:user,is_bot:false},message:{message_id:messageId,chat:{id:user,type:"private"}}}}});
    expect(response.statusCode).toBe(202);
    await app.get(TelegramUpdateProcessor).processAvailable();
  }
  async function identity(user: number) {
    return (
      await db
        .selectFrom("telegram_identity_reservations")
        .select("identity_ref")
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", String(user))
        .executeTakeFirstOrThrow()
    ).identity_ref;
  }
  async function link(user: number) {
    const linking = app.get(IdentityLinking);
    const accountRef = `account-${bot}-${user}`;
    const token = randomUUID();
    const challenge = await linking.register({
      accountRef,
      expiresAt: new Date(clock.now().getTime() + 300_000),
      returnCorrelation: randomUUID(),
      tokenDigest: createHash("sha256")
        .update(`${token}${user}`)
        .digest("base64url"),
    });
    await linking.acceptStart({
      botIdentity: bot,
      telegramUserId: String(user),
      observedAt: clock.now(),
      linkToken: {
        kind: "digest",
        digest: createHash("sha256")
          .update(`${token}${user}`)
          .digest("base64url"),
      },
    });
    const confirmed = await linking.confirm({
      accountRef,
      linkTransactionRef: challenge.linkTransactionRef,
      returnCorrelation: challenge.returnCorrelation,
    });
    expect(confirmed).toMatchObject({
      status: "linked",
      telegramIdentityRef: await identity(user),
    });
    const id = await identity(user);
    bindings.set(id, {
      accountRef,
      identityRef: id,
      linkRef: randomUUID(),
      linkRevision: 3,
    });
  }

  return {
    app,
    sent,edited,
    db,
    worker,
    bot,
    clock,
    config,
    bindings,
    proofs,
    begins,
    granted,
    rule,
    platform,
    state,
    ingress,
    callback,
    identity,
    link,
  };
}

describe("durable activation ingress, identity and continuation", () => {
  it("shows the empty Product menu and reserves management for an authorized author",async({activation:a})=>{
    await a.ingress(70108,"/start");await a.link(70108);a.state.products=[];
    const outbound=a.app.get(StartResponseDeliveryProcessor);
    await a.ingress(70108,"/start");await outbound.processAvailable(10,a.clock.now());
    expect(a.sent.at(-1)?.text).toContain("Пока нет доступных продуктов");
    expect(a.sent.at(-1)?.buttons?.some(button=>button.text==="Управление")).toBe(false);
    a.state.author="allowed";await a.ingress(70108,"/start");await outbound.processAvailable(10,a.clock.now());
    expect(a.sent.at(-1)?.buttons).toContainEqual({text:"Управление",callbackData:"author:home"});
  });
  it("keeps the selected Product through help and edits the current inline message",async({activation:a})=>{
    await a.ingress(70109,"/start");await a.link(70109);
    const id=required(a.state.products[0]).id;
    await a.callback(70109,`access:help:${id}`);
    await a.callback(70109,`access:help_signin:${id}`);
    await a.app.get(StartResponseDeliveryProcessor).processAvailable(20,a.clock.now());
    expect(a.edited.at(-1)?.messageId).toBe("42");
    expect(a.edited.at(-1)?.buttons).toContainEqual({text:"Войти на платформу",url:"https://sachkov.dev/auth/sign-in?returnTo=%2Fproducts%2Fai-engineering%2Fprogramme"});
    expect(a.edited.at(-1)?.buttons).toContainEqual({text:"Написать в поддержку",url:"https://t.me/sachkova_mng"});
  });

  it("renders current revoked rights when an old activation link repeats a historical grant",async({activation:a})=>{
    await a.ingress(70107,"/start");await a.link(70107);await a.ingress(70107,"/start a_course");
    const product=required(a.state.products[0]);
    a.state.products=[{...product,materials:{state:"revoked"},community:{state:"revoked"}}];
    await a.ingress(70107,"/start a_course");
    const queue=a.app.get(StartResponseDeliveryQueue);let last;
    for(let i=0;i<10;i++){const reply=await queue.claimNext(a.clock.now());if(!reply)break;last=reply;await queue.recordResult(reply,{kind:"delivered",providerMessageId:String(i+1)},a.clock.now());}
    expect(last?.messageText).toContain("Доступ к материалам отозван");
    expect(last?.buttons?.some(button=>button.text === "Вступить в группу")).toBe(false);
    expect(a.granted.size).toBe(1);
  });

  it("returns bounded failure for a stalled community check and permits a fresh checked retry",async ({activation:a})=>{
    await a.ingress(70106,"/start"); await a.link(70106);
    let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    let release!:()=>void;const stalled=new Promise<void>(resolve=>{release=resolve;});
    a.state.onOwn=()=>{entered();return stalled;};
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});
    try {
      const action=a.worker.action({botIdentity:a.bot,telegramUserId:"70106",privateChatId:"70106",updateId:"900001",observedAt:a.clock.now()},"community",a.state.products[0]?.id);
      await started;
      await vi.advanceTimersByTimeAsync(10000);
      await action;
      const queue=a.app.get(StartResponseDeliveryQueue);
      const texts:string[]=[];
      for(let i=0;i<5;i++){const reply=await queue.claimNext(a.clock.now());if(!reply)break;texts.push(reply.messageText);await queue.recordResult(reply,{kind:"delivered",providerMessageId:String(i+1)},a.clock.now());}
      expect(texts).toContain("Не удалось проверить доступ. Попробуйте ещё раз.");
      a.state.onOwn=undefined;
      release();
      await a.worker.action({botIdentity:a.bot,telegramUserId:"70106",privateChatId:"70106",updateId:"900002",observedAt:a.clock.now()},"community",a.state.products[0]?.id);
      expect(a.granted.size).toBe(0);
    }finally{release();vi.useRealTimers();}
  });

  it("edits the original activation card automatically after linking and replaces an uneditable old card once", async ({activation:a})=>{
    await a.ingress(70104,"/start a_course");
    const outbound=a.app.get(StartResponseDeliveryProcessor);
    await outbound.processAvailable(10,a.clock.now());
    expect(a.sent.at(-1)?.buttons).toContainEqual({text:"Продолжить на платформе",url:`https://sachkov.dev/telegram/continue?attempt=${a.begins[0]}`});
    const before=a.sent.length;
    await a.link(70104);
    await a.worker.processAvailable();
    a.state.editRejected=true;
    await outbound.processAvailable(10,a.clock.now());
    expect(a.edited.at(-1)?.messageId).toBe(String(before));
    expect(a.sent).toHaveLength(before+1);
    expect(a.sent.at(-1)?.text).toContain("Курс доступен");
    await outbound.processAvailable(10,a.clock.now());
    expect(a.sent).toHaveLength(before+1);
  });

  it("keeps a verified source proof's actual time when linking continues",async ({activation:a})=>{
    const checkedAt=a.clock.now().toISOString();
    await a.ingress(70105,"/start a_course");
    a.clock.value=new Date(a.clock.now().getTime()+30000);
    await a.worker.processAvailable();
    await a.link(70105);
    await a.worker.processAvailable();
    expect(a.proofs.at(-1)?.checkedAt).toBe(checkedAt);
  });

  it("lists linked Products by name and exposes separate current rights in a selected card", async ({
    activation,
  }) => {
    await activation.ingress(70103, "/start");
    await activation.link(70103);
    await activation.ingress(70103, "/start");
    const queue = activation.app.get(StartResponseDeliveryQueue);
    let reply;
    for (let i = 0; i < 4; i++) {
      const next = await queue.claimNext(activation.clock.now());
      if (!next) break;
      reply = next;
      await queue.recordResult(
        next,
        { kind: "delivered", providerMessageId: String(i + 1) },
        activation.clock.now(),
      );
    }
    expect(reply?.messageText).toBe(
      "Мои продукты\n\nВыберите продукт, чтобы открыть материалы или группу.",
    );
    expect(reply?.buttons).toContainEqual({
      text: "AI Engineering",
      callbackData: "access:product:11111111-1111-4111-8111-111111111111",
    });
    await activation.worker.action(
      {
        botIdentity: activation.bot,
        telegramUserId: "70103",
        privateChatId: "70103",
        updateId: "9999999",
        observedAt: activation.clock.now(),
      },
      "product",
      "11111111-1111-4111-8111-111111111111",
    );
    const card = await queue.claimNext(activation.clock.now());
    expect(card?.messageText).toBe(
      "AI Engineering\n\nМатериалы доступны. Вы можете вступить в группу курса.",
    );
    expect(card?.buttons).toContainEqual({
      text: "Открыть курс",
      url: "https://sachkov.dev/products/ai-engineering/programme",
    });
  });

  it("verifies the source before browser linking and retains the exact activation attempt", async ({
    activation,
  }) => {
    let verified = false;
    activation.state.onSourceCheck = () => {
      verified = true;
      return Promise.resolve();
    };
    await activation.ingress(70102, "/start a_course");
    expect(verified).toBe(true);
    const replies = activation.app.get(StartResponseDeliveryQueue);
    const reply = await replies.claimNext(activation.clock.now());
    expect(reply?.messageText).toContain("подтверждено");
    expect(reply?.buttons).toContainEqual({
      text: "Продолжить на платформе",
      url: `https://sachkov.dev/telegram/continue?attempt=${activation.begins[0]}`,
    });
    await activation.link(70102);
    activation.clock.value = new Date(activation.clock.now().getTime() + 1000);
    await activation.worker.processAvailable();
    expect(activation.granted.size).toBe(1);
    expect(activation.proofs.at(-1)?.attemptId).toBe(activation.begins[0]);
  });

  it("shows ordinary start without creating an Account or checking activation", async ({
    activation,
  }) => {
    await activation.ingress(70101, "/start");
    const reply = await activation.app
      .get(StartResponseDeliveryQueue)
      .claimNext(activation.clock.now());
    expect(reply).toMatchObject({
      messageText:
        "Inside\n\nНа платформе доступны продукты и учебные материалы. Войдите и подключите Telegram, чтобы видеть свои продукты и вступать в их группы.",
      buttons: [
        { text: "Открыть платформу", url: "https://sachkov.dev" },
        {
          text: "Уже есть аккаунт",
          url: "https://sachkov.dev/auth/sign-in?returnTo=%2Faccount%2Faccess",
        },
        { text: "Помощь", callbackData: "access:help" },
      ],
    });
    expect(activation.begins).toEqual([]);
    expect(activation.granted.size).toBe(0);
  });

  it("keeps the same source identity across linking, two links and concurrent workers", async ({
    activation,
  }) => {
    const {
      db,
      worker,
      bot,
      clock,
      bindings,
      proofs,
      granted,
      rule,
      ingress,
      identity,
      link,
    } = activation;
    await ingress(70001, "/start a_course");
    await worker.processAvailable();
    expect(
      await db
        .selectFrom("activation_attempts")
        .select("state")
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", "70001")
        .executeTakeFirst(),
    ).toEqual({ state: "needs_account" });
    expect(granted.size).toBe(0);
    await link(70001);
    clock.value = new Date(clock.now().getTime() + 60_000);
    await Promise.all([worker.processAvailable(), worker.processAvailable()]);
    expect(granted.size).toBe(1);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({
      ...bindings.get(await identity(70001)),
      ruleId: rule.id,
      ruleRevision: 1,
    });
    await ingress(70001, "/start a_second_code");
    await worker.processAvailable();
    expect(granted.size).toBe(1);
    const prompt = await db
      .selectFrom("start_response_deliveries")
      .select(["buttons", "message_text"])
      .where("bot_identity", "=", bot)
      .where("source_key", "like", "activation:%")
      .execute();
    expect(
      prompt.some(
        (row) =>
          row.buttons?.some((button) => button.text === "Открыть курс") ===
          true,
      ),
    ).toBe(true);
    expect(
      await db
        .selectFrom("membership_check_results")
        .selectAll()
        .where("telegram_identity_ref", "=", await identity(70001))
        .execute(),
    ).toHaveLength(0);
  });
  it("replays exactly the persisted evidence after a lost response and restart", async ({
    activation,
  }) => {
    const {
      app,
      db,
      worker,
      clock,
      config,
      proofs,
      platform,
      state,
      ingress,
      identity,
      link,
    } = activation;
    await ingress(70002, "/start a_course");
    await link(70002);
    state.loseResponse = true;
    await worker.processAvailable();
    const first = required(proofs.at(-1));
    expect(first.identityRef).toBe(await identity(70002));
    clock.value = new Date(clock.now().getTime() + 31 * 24 * 60 * 60_000);
    const restarted = new SubscriptionActivation(
      db,
      config,
      clock,
      platform,
      new SourceGroupProof([], {
        getBotChatMember() {
          return Promise.reject(new Error("must replay before recheck"));
        },
        getChatMember() {
          return Promise.reject(new Error("must replay before recheck"));
        },
      }),
      app.get(StartResponseDeliveryQueue),
      app.get(
        (await import("../../src/modules/community/community-provider.js"))
          .CommunityProvider,
      ),
    );
    await restarted.processAvailable();
    expect(proofs.at(-1)).toEqual(first);
  });
  it("replays an expired unaccepted payload before creating fresh evidence", async ({
    activation,
  }) => {
    const { worker, clock, proofs, granted, state, ingress, identity, link } =
      activation;
    await ingress(70007, "/start a_course");
    await link(70007);
    state.dropBeforeAccept = true;
    await worker.processAvailable();
    const first = required(proofs.at(-1));
    clock.value = new Date(clock.now().getTime() + 301_000);
    await worker.processAvailable();
    expect(proofs.at(-2)).toEqual(first);
    expect(required(proofs.at(-1)).evidenceRef).not.toBe(first.evidenceRef);
    expect(granted.has(`course:${await identity(70007)}`)).toBe(true);
  });
  it("stops identity conflict until an explicit user retry", async ({
    activation,
  }) => {
    const { worker, clock, proofs, granted, state, ingress, identity, link } =
      activation;
    await ingress(70008, "/start a_course");
    await link(70008);
    state.dropBeforeAccept = true;
    await worker.processAvailable();
    state.evidenceConflict = true;
    clock.value = new Date(clock.now().getTime() + 60_000);
    await worker.processAvailable();
    const count = proofs.length;
    state.evidenceConflict = false;
    clock.value = new Date(clock.now().getTime() + 60_000);
    await worker.processAvailable();
    expect(proofs).toHaveLength(count);
    expect(granted.has(`course:${await identity(70008)}`)).toBe(false);
    await ingress(70008, "/start a_course");
    await worker.processAvailable();
    expect(granted.has(`course:${await identity(70008)}`)).toBe(true);
  });
  it("prevents a stale worker from submitting after another worker takes its lease", async ({
    activation,
  }) => {
    const { worker, clock, proofs, state, ingress, identity, link } =
      activation;
    await ingress(70009, "/start a_course");
    await link(70009);
    state.onSourceCheck = async () => {
      clock.value = new Date(clock.now().getTime() + 61_000);
      await worker.processAvailable();
    };
    await worker.processAvailable();
    const id = await identity(70009);
    expect(proofs.filter((p) => p.identityRef === id)).toHaveLength(1);
  });
  it("distinguishes unavailable binding from missing Account and rejects nonmembers", async ({
    activation,
  }) => {
    const { db, worker, bot, clock, granted, state, ingress, identity, link } =
      activation;
    state.bindingUnavailable = true;
    await ingress(70003, "/start a_course");
    await worker.processAvailable();
    expect(
      await db
        .selectFrom("activation_attempts")
        .select(["state", "diagnostic_code"])
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", "70003")
        .executeTakeFirst(),
    ).toEqual({ state: "retry", diagnostic_code: "binding_unavailable" });
    state.bindingUnavailable = false;
    await link(70003);
    state.source = "not_member";
    clock.value = new Date(clock.now().getTime() + 301_000);
    await worker.processAvailable();
    expect(granted.has(`course:${await identity(70003)}`)).toBe(false);
    state.source = "member";
  });
  it("recovers saved unavailable without a rule and suppresses unchanged automatic replies", async ({
    activation,
  }) => {
    const {
      db,
      worker,
      bot,
      clock,
      proofs,
      granted,
      state,
      ingress,
      identity,
      link,
    } = activation;
    state.source = "unavailable";
    await ingress(70005, "/start a_course");
    await link(70005);
    await worker.processAvailable();
    const initialAttempt = required(activation.begins.at(-1));
    for (let i = 0; i < 3; i++) {
      clock.value = new Date(clock.now().getTime() + 60_000);
      await worker.processAvailable();
    }
    const replies = await db
      .selectFrom("start_response_deliveries")
      .select("id")
      .where("bot_identity", "=", bot)
      .where("telegram_user_id", "=", "70005")
      .where("source_key", "like", "activation:%:unavailable")
      .execute();
    expect(replies).toHaveLength(1);
    state.source = "member";
    clock.value = new Date(clock.now().getTime() + 60_000);
    await worker.processAvailable();
    expect(required(proofs.at(-1)).attemptId).not.toBe(initialAttempt);
    expect(granted.has(`course:${await identity(70005)}`)).toBe(true);
  });
  it("expires known unavailable work and permits a fresh explicit start", async ({
    activation,
  }) => {
    const {
      db,
      worker,
      bot,
      clock,
      proofs,
      begins,
      granted,
      state,
      ingress,
      identity,
      link,
    } = activation;
    state.source = "unavailable";
    await ingress(70011, "/start a_course");
    await link(70011);
    await worker.processAvailable();
    const firstAttempt = required(begins.at(-1));
    const calls = { begins: begins.length, proofs: proofs.length };
    clock.value = new Date(clock.now().getTime() + 31 * 24 * 60 * 60_000);
    await worker.processAvailable();
    expect({ begins: begins.length, proofs: proofs.length }).toEqual(calls);
    expect(
      await db
        .selectFrom("activation_attempts")
        .selectAll()
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", "70011")
        .execute(),
    ).toEqual([]);
    state.source = "member";
    await ingress(70011, "/start a_course");
    await worker.processAvailable();
    expect(required(proofs.at(-1)).attemptId).not.toBe(firstAttempt);
    expect(granted.has(`course:${await identity(70011)}`)).toBe(true);
  });
  it("resolves expired uncertain evidence before cleanup without starting a new proof", async ({
    activation,
  }) => {
    const {
      db,
      worker,
      bot,
      clock,
      proofs,
      begins,
      granted,
      state,
      ingress,
      identity,
      link,
    } = activation;
    await ingress(70010, "/start a_course");
    await link(70010);
    state.dropBeforeAccept = true;
    await worker.processAvailable();
    const first = required(proofs.at(-1));
    const beginCount = begins.length;
    clock.value = new Date(clock.now().getTime() + 31 * 24 * 60 * 60_000);
    await worker.processAvailable();
    expect(proofs.at(-1)).toEqual(first);
    expect(begins).toHaveLength(beginCount);
    expect(granted.has(`course:${await identity(70010)}`)).toBe(false);
    expect(
      await db
        .selectFrom("activation_attempts")
        .selectAll()
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", "70010")
        .execute(),
    ).toEqual([]);
  });
  it("allows a rejected course to be checked again after retention", async ({
    activation,
  }) => {
    const { worker, clock, proofs, granted, state, ingress, identity, link } =
      activation;
    state.source = "not_member";
    await ingress(70006, "/start a_course");
    await link(70006);
    await worker.processAvailable();
    const rejectedAttempt = required(activation.begins.at(-1));
    clock.value = new Date(clock.now().getTime() + 31 * 24 * 60 * 60_000);
    state.source = "member";
    await ingress(70006, "/start a_course");
    await worker.processAvailable();
    expect(required(proofs.at(-1)).attemptId).not.toBe(rejectedAttempt);
    expect(granted.has(`course:${await identity(70006)}`)).toBe(true);
  });
  it("purges old unlinked attempts while retaining the stable source identity", async ({
    activation,
  }) => {
    const { db, worker, bot, clock, ingress, identity } = activation;
    await ingress(70004, "/start a_course");
    await worker.processAvailable();
    const before = await identity(70004);
    await db
      .updateTable("activation_attempts")
      .set({ expires_at: new Date(clock.now().getTime() - 1) })
      .where("bot_identity", "=", bot)
      .where("telegram_user_id", "=", "70004")
      .execute();
    await worker.processAvailable();
    await ingress(70004, "/start a_course");
    expect(await identity(70004)).toBe(before);
    expect(
      await db
        .selectFrom("activation_attempts")
        .selectAll()
        .where("bot_identity", "=", bot)
        .where("telegram_user_id", "=", "70004")
        .execute(),
    ).toHaveLength(1);
  });
});
