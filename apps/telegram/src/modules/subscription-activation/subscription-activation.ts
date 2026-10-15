import { StartResponseDeliveryProcessor } from "../outbound/start-response-delivery-processor.js";
import {
  productList,
  productCard,
  helpScreen,
  courseButton,
  SUPPORT_URL,
  type LearnerScreen,
} from "./learner-view.js";
import { Optional } from "@nestjs/common";
import {
  AUTHOR_AUTHORIZATION,
  type AuthorAuthorization,
} from "../communications/author-authorization.js";
import { isTruthy } from "../../shared/truthiness.js";
import { hasText } from "../../shared/text.js";
import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Selectable, type Transaction } from "kysely";
import {
  DATABASE,
  type Database,
  type DatabaseSchema,
} from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import { reserveTelegramIdentity } from "../identity-linking/stable-telegram-identity.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";
import { StartResponseDeliveryQueue } from "../outbound/start-response-delivery-queue.js";
import type { TelegramButton } from "../outbound/telegram-messages.js";
import { CommunityProvider } from "../community/community-provider.js";
import {
  ACTIVATION_PLATFORM,
  type ActivationPlatform,
} from "./activation-ports.js";
import { SourceGroupProof } from "./source-group-proof.js";
import {
  ACTIVATION_VERSION,
  type ActivationEvidence,
  type ActivationResponse,
  type ActivationResult,
  type ActivationState,
} from "./activation-contract.js";
import {
  accountPrompt,
  activationMenu,
  activationMessage,
  asksToWriteAuthor,
  OWNER_REVIEW,
} from "./activation-view.js";
import type { ActivationTables, GroundOutcome } from "./activation-storage.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";

type Attempt = Selectable<ActivationTables["activation_attempts"]>;
const RETENTION = 30 * 24 * 60 * 60_000;
const CADENCE = 60_000;
const SOURCE_PROOF_WINDOW_MS = 300_000;
const LEARNER_ACTION_TIMEOUT_MS = 10_000;
// A known unfinished outcome may expire. Never discard an uncertain evidence write
// or a confirmed Enrollment receipt just because the user has not returned. An expired
// confirmed attempt stops retrying and returns to completed; the deletions skip it.
// Parenthesized as a whole, because callers negate it.
const expirableAttempt = sql<boolean>`(coalesce(
  (evidence is null and result is null)
  or result->>'ok' = 'false'
  or result->'value'->>'state' in ('unavailable', 'checking', 'needs_account', 'pending_review'), false))`;
export type AccessAction =
  | "own"
  | "product"
  | "community"
  | "retry"
  | "help"
  | "help_missing"
  | "help_group"
  | "help_signin"
  | "platform";

/** Durable Telegram continuation; Account and every grant remain Platform-owned. */
@Injectable()
export class SubscriptionActivation {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ACTIVATION_PLATFORM) private readonly platform: ActivationPlatform,
    @Inject(SourceGroupProof) private readonly proof: SourceGroupProof,
    @Inject(StartResponseDeliveryQueue)
    private readonly replies: StartResponseDeliveryQueue,
    @Inject(CommunityProvider) private readonly community: CommunityProvider,
    @Optional()
    @Inject(AUTHOR_AUTHORIZATION)
    private readonly authors?: AuthorAuthorization,
    @Optional()
    @Inject(StartResponseDeliveryProcessor)
    private readonly outbound?: StartResponseDeliveryProcessor,
  ) {}

  async start(
    contact: VerifiedPrivateStart,
    code: string | null,
  ): Promise<void> {
    if (!isTruthy(this.config.activation?.enabled) || !hasText(code)) {
      await this.reply(
        contact,
        "Активация по этой ссылке сейчас недоступна. Обратитесь к владельцу.",
      );
      return;
    }
    const now = this.clock.now();
    await this.db.transaction().execute(async (tx) => {
      const identity = await reserveTelegramIdentity(
        tx,
        contact.botIdentity,
        contact.telegramUserId,
      );
      await tx
        .deleteFrom("activation_attempts")
        .where("bot_identity", "=", contact.botIdentity)
        .where("telegram_user_id", "=", contact.telegramUserId)
        .where("expires_at", "<=", now)
        .where("state", "in", [
          "pending",
          "needs_account",
          "retry",
          "pending_review",
        ])
        .where(expirableAttempt)
        .where("confirmed_at", "is", null)
        .where((eb) =>
          eb.or([eb("lease_until", "is", null), eb("lease_until", "<=", now)]),
        )
        .execute();
      await tx
        .insertInto("activation_attempts")
        .values(newAttempt(contact, identity, code, now))
        .onConflict((c) =>
          c
            .columns(["bot_identity", "telegram_user_id", "code"])
            .doUpdateSet({ due_at: now }),
        )
        .execute();
    });
    // Only the link's own rule starts again; the person's other checks keep their answers.
    await this.action(contact, "retry", code);
  }

  /** `onlyCode` limits a retry to one rule, as an owner link does. */
  async action(
    contact: VerifiedPrivateStart,
    action: AccessAction,
    onlyCode?: string,
  ): Promise<void> {
    if (action !== "community" && action !== "retry")
      return this.performAction(contact, action, onlyCode);
    const failure = () => this.screen(contact,{
      text:"Не удалось проверить доступ. Попробуйте ещё раз.",
      buttons:[{text:"Повторить",callbackData:hasText(onlyCode)?`access:${action}:${onlyCode}`:"access:own"},{text:"Помощь",callbackData:action === "community" && hasText(onlyCode)?`access:help:${onlyCode}`:"access:help"}],
    });
    let timer:ReturnType<typeof setTimeout>|undefined;
    const work = (async()=>{
      if(action === "community") {
        const progressKey=`access-progress:${contact.botIdentity}:${contact.updateId}`;
        await this.replies.enqueue({...this.delivery(contact,"Проверяем доступ к группе…"),sourceKey:progressKey});
        await this.flush(progressKey);
      }
      await this.performAction(contact,action,onlyCode);
    })();
    try {
      await Promise.race([work,new Promise<void>((resolve,reject)=>{
        timer=setTimeout(()=>{void failure().then(resolve,reject);},LEARNER_ACTION_TIMEOUT_MS);
      })]);
    } catch(error:unknown) {
      reportFailure("activation.action",error);
      await failure();
    } finally {if(timer !== undefined) clearTimeout(timer);}
    // A late result shares the durable reply key with the timeout and cannot send another answer.
    void work.catch((error:unknown)=>reportFailure("activation.action",error));
  }

  private async performAction(
    contact: VerifiedPrivateStart,
    action: AccessAction,
    onlyCode?: string,
  ): Promise<void> {
    const config = this.config.activation;
    if (!isTruthy(config?.enabled)) {
      await this.reply(
        contact,
        "Не удалось проверить доступ. Напишите автору курса.",
      );
      return;
    }
    if (action === "platform") {
      const prompt = accountPrompt(config.accountUrl, onlyCode);
      await this.replies.enqueue({
        ...this.delivery(contact, prompt.text),
        buttons: prompt.buttons,
      });
      return;
    }
    const identity = await this.db
      .transaction()
      .execute((tx) =>
        reserveTelegramIdentity(
          tx,
          contact.botIdentity,
          contact.telegramUserId,
        ),
      );
    if (action === "retry") {
      await this.db.transaction().execute(async (tx) => {
        let query = tx
          .selectFrom("activation_attempts")
          .selectAll()
          .where("bot_identity", "=", contact.botIdentity)
          .where("telegram_user_id", "=", contact.telegramUserId);
        if (onlyCode !== undefined) query = query.where("code", "=", onlyCode);
        const rows = await query.forUpdate().execute();
        const now = this.clock.now();
        for (const row of rows)
          await reschedule(tx, row, now, contact.updateId);
      });
      await this.processAvailable(10, {
        telegramUserId: contact.telegramUserId,
        ...(onlyCode === undefined ? {} : { code: onlyCode }),
      });
      return;
    }
    const lookup = await this.platform.binding(identity);
    if (!lookup || !lookup.ok) {
      await this.reply(
        contact,
        lookup?.error.code === "identity_conflict"
          ? "Связь аккаунта требует помощи владельца. Проверка остановлена; аккаунты не объединяются."
          : "Платформа временно не отвечает. Повторите проверку позже.",
        onlyCode,
      );
      return;
    }
    if (action.startsWith("help")) {
      const access =
        lookup.value.state === "linked" && hasText(onlyCode)
          ? await this.platform.own(lookup.value.binding)
          : undefined;
      const product = access?.ok === true ? access.value.products?.find(item=>item.id === onlyCode) : undefined;
      const attempts = product || !hasText(onlyCode) ? [] : await this.db.selectFrom("activation_attempts").select(["attempt_id","source_proof","code"]).where("bot_identity","=",contact.botIdentity).where("telegram_user_id","=",contact.telegramUserId).execute();
      const attempt = attempts.find(row=>row.source_proof?.product?.id === onlyCode);
      await this.screen(contact,helpScreen(action,product?.id ?? attempt?.source_proof?.product?.id,product?.programmeUrl,attempt ? `https://sachkov.dev/telegram/continue?attempt=${attempt.attempt_id}` : undefined,attempt ? `access:retry:${attempt.code}` : undefined));
      return;
    }
    if (lookup.value.state === "unlinked" && action === "own") {
      await this.replies.enqueue({
        ...this.delivery(
          contact,
          "Inside\n\nНа платформе доступны продукты и учебные материалы. Войдите и подключите Telegram, чтобы видеть свои продукты и вступать в их группы.",
        ),
        buttons: [
          { text: "Открыть платформу", url: "https://sachkov.dev" },
          {
            text: "Уже есть аккаунт",
            url: "https://sachkov.dev/auth/sign-in?returnTo=%2Faccount%2Faccess",
          },
          { text: "Помощь", callbackData: "access:help" },
        ],
      });
      return;
    }
    if (lookup.value.state === "unlinked") {
      const prompt = accountPrompt(config.accountUrl, onlyCode);
      await this.replies.enqueue({
        ...this.delivery(contact, prompt.text),
        buttons: prompt.buttons,
      });
      return;
    }
    if (lookup.value.binding.identityRef !== identity) {
      await this.reply(contact, "Связь аккаунта требует проверки владельца.");
      return;
    }
    const access = await this.platform.own(
      lookup.value.binding,
      action === "community",
    );
    if (!isTruthy(access?.ok)) {
      await this.reply(
        contact,
        access && !access.ok && access.error.code === "identity_conflict"
          ? "Связь аккаунта требует помощи владельца. Проверка остановлена; аккаунты не объединяются."
          : "Не удалось получить актуальные доступы. Повторите проверку; аккаунт и история сохраняются.",
      );
      return;
    }
    if (action === "own") {
      const author = await this.authors?.authorize({
        kind: "telegram",
        accountRef: lookup.value.binding.accountRef,
        telegramIdentityRef: identity,
        botIdentity: contact.botIdentity,
      });
      await this.screen(
        contact,
        productList(access.value.products ?? [], author === "allowed"),
      );
      return;
    }
    const product = access.value.products?.find((item) => item.id === onlyCode);
    if (!product) {
      await this.screen(contact, {
        text: "Не удалось проверить доступ. Попробуйте ещё раз.",
        buttons: [
          { text: "Повторить", callbackData: "access:own" },
          { text: "Помощь", callbackData: "access:help" },
        ],
      });
      return;
    }
    if (action === "product") {
      const admission = await this.community.currentAdmission(
        contact.telegramUserId,
      );
      const card = productCard(product, admission);
      const groupUrl = this.community.groupUrl();
      await this.screen(contact, {
        ...card,
        buttons: [
          ...courseButton(product),
          ...(admission.kind === "member" &&
          hasText(groupUrl) &&
          product.community.state === "available"
            ? [{ text: "Открыть группу", url: groupUrl }]
            : []),
          ...card.buttons.slice(courseButton(product).length),
        ],
      });
      return;
    }
    if (product.community.state !== "available") {
      await this.screen(contact, productCard(product, { kind: "none" }));
      return;
    }
    const admission =
      this.config.communityMode === "live"
        ? await this.community.requestAdmission(contact.telegramUserId)
        : { kind: "preparing" as const };
    const back: TelegramButton = {
      text: "Назад к продукту",
      callbackData: `access:product:${product.id}`,
    };
    const groupUrl = this.community.groupUrl();
    const buttons: TelegramButton[] = [...courseButton(product), back];
    if (admission.kind === "link")
      buttons.unshift({ text: "Вступить в группу", url: admission.inviteLink });
    if (admission.kind === "member" && hasText(groupUrl))
      buttons.unshift({ text: "Открыть группу", url: groupUrl });
    if (admission.kind === "moderation_blocked")
      buttons.unshift({ text: "Написать в поддержку", url: SUPPORT_URL });
    if (admission.kind === "preparing" || admission.kind === "none")
      buttons.unshift(
        { text: "Повторить", callbackData: `access:community:${product.id}` },
        { text: "Помощь", callbackData: `access:help:${product.id}` },
      );
    await this.screen(contact, {
      text:
        admission.kind === "link"
          ? `${product.name}\n\nМожно вступить в группу курса.`
          : admission.kind === "member"
            ? `${product.name}\n\nВы уже в группе курса.`
            : admission.kind === "moderation_blocked"
              ? `${product.name}\n\nВступление в группу ограничено. Напишите в поддержку, чтобы уточнить причину.`
              : "Не удалось проверить доступ. Попробуйте ещё раз.",
      buttons,
    });
  }

  private async screen(
    contact: VerifiedPrivateStart,
    screen: LearnerScreen,
  ): Promise<void> {
    const reply = {
      ...this.delivery(contact, screen.text),
      buttons: screen.buttons,
    };
    await this.replies.enqueue(reply);
    await this.flush(reply.sourceKey);
  }
  private async flush(sourceKey: string): Promise<void> {
    if (this.config.deliveryMode === "live")
      await this.outbound?.processSource(sourceKey);
  }

  async processAvailable(
    limit = 10,
    selected?: { readonly telegramUserId: string; readonly code?: string },
  ): Promise<number> {
    if (!isTruthy(this.config.activation?.enabled)) return 0;
    let processed = 0;
    for (; processed < limit; processed++) {
      const now = this.clock.now();
      const attempt = await this.db.transaction().execute(async (tx) => {
        let query = tx
          .selectFrom("activation_attempts")
          .selectAll()
          .where("bot_identity", "=", this.config.botIdentity)
          .where("state", "in", ["pending", "needs_account", "retry"])
          .where("due_at", "<=", now)
          .where((eb) =>
            eb.or([eb("expires_at", ">", now), eb.not(expirableAttempt)]),
          )
          .where((eb) =>
            eb.or([
              eb("lease_until", "is", null),
              eb("lease_until", "<=", now),
            ]),
          );
        if (selected !== undefined)
          query = query.where("telegram_user_id", "=", selected.telegramUserId);
        if (selected?.code !== undefined)
          query = query.where("code", "=", selected.code);
        const row = await query
          .orderBy("due_at")
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!row) return;
        const lease = randomUUID();
        await tx
          .updateTable("activation_attempts")
          .set({
            lease_token: lease,
            lease_until: new Date(now.getTime() + CADENCE),
            attempts: row.attempts + 1,
          })
          .where("attempt_id", "=", row.attempt_id)
          .execute();
        return { ...row, lease_token: lease };
      });
      if (!attempt) break;
      try {
        await this.process(attempt);
        await this.flush(`activation:${attempt.attempt_id}:needs_account`);
      } catch (error) {
        reportFailure("activation.process", error, {
          attempt_id: attempt.attempt_id,
        });
        await this.defer(attempt, "worker_unavailable");
      }
    }
    await this.db
      .deleteFrom("activation_attempts")
      .where("bot_identity", "=", this.config.botIdentity)
      .where("expires_at", "<=", this.clock.now())
      .where("state", "in", [
        "pending",
        "needs_account",
        "retry",
        "pending_review",
      ])
      .where(expirableAttempt)
      .where("confirmed_at", "is", null)
      .where((eb) =>
        eb.or([
          eb("lease_until", "is", null),
          eb("lease_until", "<=", this.clock.now()),
        ]),
      )
      .execute();
    // An expired retry of a confirmed ground ends where it started: confirmed, not pending.
    await this.db
      .updateTable("activation_attempts")
      .set({ state: "completed" })
      .where("bot_identity", "=", this.config.botIdentity)
      .where("expires_at", "<=", this.clock.now())
      .where("state", "in", ["pending", "needs_account", "retry"])
      .where(expirableAttempt)
      .where("confirmed_at", "is not", null)
      .where((eb) =>
        eb.or([
          eb("lease_until", "is", null),
          eb("lease_until", "<=", this.clock.now()),
        ]),
      )
      .execute();
    return processed;
  }

  private async process(attempt: Attempt): Promise<void> {
    // An uncertain write is replayed byte-for-byte before considering new source evidence.
    if (attempt.evidence && attempt.result === null) {
      const replay = await this.platform.evidence(attempt.evidence);
      if (!replay) {
        await this.defer(attempt, "evidence_response_unknown");
        return;
      }
      if (!replay.ok && replay.error.code === "identity_conflict") {
        await this.finish(attempt, replay);
        return;
      }
      if (
        replay.ok ||
        (!["revision_conflict", "invalid_input"].includes(replay.error.code) &&
          !(
            replay.error.code === "source_not_confirmed" &&
            Date.parse(attempt.evidence.validUntil) <=
              this.clock.now().getTime()
          ))
      ) {
        await this.finish(
          attempt,
          replay.ok && attempt.source_proof?.product
            ? {
                ...replay,
                value: {
                  ...replay.value,
                  rule: {
                    id: attempt.source_proof.ruleId,
                    revision: attempt.source_proof.ruleRevision,
                    sourceRef: attempt.source_proof.sourceRef ?? "",
                    product: attempt.source_proof.product,
                  },
                },
              }
            : replay,
        );
        return;
      }
      const expired = attempt.expires_at <= this.clock.now();
      await this.db
        .updateTable("activation_attempts")
        .set({
          evidence: null,
          ...(expired ? { lease_token: null, lease_until: null } : {}),
        })
        .where("attempt_id", "=", attempt.attempt_id)
        .where("lease_token", "=", attempt.lease_token)
        .execute();
      if (expired) return; // The uncertain write is resolved; do not start fresh proof after retention.
    }
    if (
      attempt.result !== null &&
      (attempt.result.ok
        ? ["unavailable", "checking"].includes(attempt.result.value.state)
        : attempt.result.error.code === "unavailable")
    ) {
      await this.db
        .updateTable("activation_attempts")
        .set({
          attempt_id: randomUUID(),
          evidence: null,
          result: null,
          state: "pending",
          lease_token: null,
          lease_until: null,
          due_at: this.clock.now(),
        })
        .where("attempt_id", "=", attempt.attempt_id)
        .where("lease_token", "=", attempt.lease_token)
        .execute();
      return;
    }
    const begun = await this.platform.begin({
      contractVersion: ACTIVATION_VERSION,
      attemptId: attempt.attempt_id,
      code: attempt.code,
      identityRef: attempt.identity_ref,
    });
    if (!begun) {
      await this.defer(attempt, "platform_unavailable");
      return;
    }
    if (!begun.ok) {
      await this.finish(attempt, begun);
      return;
    }
    if (
      begun.value.attemptId === attempt.attempt_id &&
      confirmedResult(begun)
    ) {
      await this.finish(attempt, begun);
      return;
    }
    if (
      begun.value.attemptId === attempt.attempt_id &&
      begun.value.state === "pending_review" &&
      !begun.value.rule
    ) {
      await this.finish(attempt, begun);
      return;
    }
    if (begun.value.attemptId !== attempt.attempt_id || !begun.value.rule) {
      await this.defer(attempt, "invalid_attempt_response");
      return;
    }
    const rule = begun.value.rule;
    if(this.config.deliveryMode === "live") {
      const progressKey=`activation:${attempt.attempt_id}:progress`;
      await this.replies.enqueue({...this.delivery(this.contact(attempt),`${rule.product?.name ?? "Курс"}\n\nПроверяем участие в ${this.sourceName(rule.sourceRef)}…`),sourceKey:progressKey});
      await this.flush(progressKey);
    }
    const checkedAt = this.clock.now();
    const cached = attempt.source_proof;
    const reusable =
      cached !== null &&
      cached.ruleId === rule.id &&
      cached.ruleRevision === rule.revision &&
      Date.parse(cached.validUntil) > checkedAt.getTime();
    const proof = reusable
        ? { decision: cached.decision }
        : await this.proof.check(
            rule.sourceRef,
            attempt.identity_ref,
            attempt.telegram_user_id,
          );
    if (proof.decision !== "member") {
      await this.finish(attempt, {
        ok: true,
        value: {
          ...begun.value,
          state: proof.decision === "not_member" ? "rejected" : "unavailable",
        },
      });
      return;
    }
    const proofCheckedAt = reusable ? cached.checkedAt : checkedAt.toISOString();
    const proofValidUntil = reusable ? cached.validUntil : new Date(checkedAt.getTime()+SOURCE_PROOF_WINDOW_MS).toISOString();
    const saved = await this.db
      .updateTable("activation_attempts")
      .set({
        source_proof: {
          decision: proof.decision,
          ruleId: rule.id,
          ruleRevision: rule.revision,
          checkedAt: proofCheckedAt,
          validUntil: proofValidUntil,
          sourceRef: rule.sourceRef,
          ...(rule.product ? { product: rule.product } : {}),
        },
      })
      .where("attempt_id", "=", attempt.attempt_id)
      .where("lease_token", "=", attempt.lease_token)
      .where("lease_until",">",this.clock.now())
      .returning("attempt_id").executeTakeFirst();
    if(!saved) return;
    const lookup = await this.platform.binding(attempt.identity_ref);
    if (!lookup || !lookup.ok) {
      if (lookup?.error.code === "identity_conflict")
        await this.finish(attempt, lookup);
      else await this.defer(attempt, "binding_unavailable");
      return;
    }
    if (lookup.value.state === "unlinked") {
      const editMessageId = await this.replies.deliveredMessageId(`activation:${attempt.attempt_id}:progress`);
      await this.replies.enqueue({
        ...(hasText(editMessageId) ? {editMessageId} : {}),
        ...this.delivery(
          this.contact(attempt),
          `${rule.product?.name ?? "Курс"}\n\nУчастие в ${this.sourceName(rule.sourceRef)} подтверждено. Продолжите на платформе, чтобы получить доступ к курсу.`,
        ),
        sourceKey: `activation:${attempt.attempt_id}:needs_account`,
        buttons: [
          {
            text: "Продолжить на платформе",
            url: `https://sachkov.dev/telegram/continue?attempt=${attempt.attempt_id}`,
          },
          { text: "Помощь", callbackData: rule.product ? `access:help:${rule.product.id}` : "access:help" },
        ],
      });
      await this.defer(attempt, "needs_account", "needs_account", 1000);
      return;
    }
    const binding = lookup.value.binding;
    if (binding.identityRef !== attempt.identity_ref) {
      await this.finish(attempt, {
        ok: false,
        error: { code: "identity_conflict" },
      });
      return;
    }
    const evidence: ActivationEvidence = {
      contractVersion: ACTIVATION_VERSION,
      audience: "inside.platform.subscription-activation",
      evidenceRef: randomUUID(),
      attemptId: attempt.attempt_id,
      sourceRef: rule.sourceRef,
      ...binding,
      ruleId: rule.id,
      ruleRevision: rule.revision,
      checkedAt: proofCheckedAt,
      validUntil: proofValidUntil,
      decision: proof.decision,
    };
    const persisted = await this.db
      .updateTable("activation_attempts")
      .set({ evidence, result: null })
      .where("attempt_id", "=", attempt.attempt_id)
      .where("lease_token", "=", attempt.lease_token)
      .where("lease_until", ">", this.clock.now())
      .returning("attempt_id")
      .executeTakeFirst();
    if (!persisted) return;
    const response = await this.platform.evidence(evidence);
    if (!response) {
      await this.defer(attempt, "evidence_response_unknown");
      return;
    }
    await this.finish(
      attempt,
      response.ok
        ? { ...response, value: { ...response.value, rule } }
        : response,
      Math.max(CADENCE, (proof.retryAfterSeconds ?? 0) * 1000),
    );
  }

  private async finish(
    attempt: Attempt,
    result: ActivationResult<ActivationResponse>,
    delay = CADENCE,
  ): Promise<void> {
    if (result.ok && result.value.attemptId !== attempt.attempt_id) {
      await this.defer(attempt, "invalid_attempt_response");
      return;
    }
    const retry = result.ok
      ? ["unavailable", "checking", "needs_account"].includes(
          result.value.state,
        )
      : result.error.code === "unavailable";
    const confirmed = confirmedResult(result);
    let currentScreen:LearnerScreen|undefined;
    const productId=result.ok ? result.value.rule?.product?.id ?? attempt.source_proof?.product?.id : undefined;
    if(confirmed && hasText(productId)) {
      const lookup=await this.platform.binding(attempt.identity_ref);
      const access=lookup?.ok === true && lookup.value.state === "linked" ? await this.platform.own(lookup.value.binding) : undefined;
      const product=access?.ok === true ? access.value.products?.find(item=>item.id === productId) : undefined;
      if(product) {
        const admission=await this.community.currentAdmission(attempt.telegram_user_id);
        currentScreen=productCard(product,admission);
        const groupUrl=this.community.groupUrl();
        if(admission.kind === "member" && hasText(groupUrl) && product.community.state === "available") currentScreen={...currentScreen,buttons:[...courseButton(product),{text:"Открыть группу",url:groupUrl},...currentScreen.buttons.slice(courseButton(product).length)]};
        if(product.materials.state === "available" && product.community.state === "available") currentScreen={...currentScreen,text:`${product.name}\n\n${admission.kind === "member" ? "Курс доступен. Вы уже в группе курса." : "Курс доступен. Открывайте материалы и присоединяйтесь к группе курса."}`};
      } else currentScreen={text:"Не удалось проверить доступ. Попробуйте ещё раз.",buttons:[{text:"Повторить",callbackData:"access:own"},{text:"Помощь",callbackData:"access:help"}]};
    }
    const reviewBinding=unconfirmedGround(result) ? await this.platform.binding(attempt.identity_ref) : undefined;
    const reviewAccountRef=reviewBinding?.ok === true && reviewBinding.value.state === "linked" ? reviewBinding.value.binding.accountRef : undefined;
    const editMessageId = (await this.replies.deliveredMessageId(`activation:${attempt.attempt_id}:needs_account`)) ?? (await this.replies.deliveredMessageId(`activation:${attempt.attempt_id}:progress`));
    await this.db.transaction().execute(async (tx) => {
      const stored = await tx
        .updateTable("activation_attempts")
        .set({
          result,
          state: retry
            ? "retry"
            : result.ok && result.value.state === "pending_review"
              ? "pending_review"
              : confirmed
                ? "completed"
                : "rejected",
          due_at: new Date(this.clock.now().getTime() + delay),
          lease_token: null,
          lease_until: null,
          diagnostic_code: result.ok ? null : result.error.code,
          // Kept once set: a later retry result must not hide rights Platform granted.
          ...(confirmed
            ? {
                confirmed_at: sql<Date>`coalesce(confirmed_at, ${this.clock.now()})`,
              }
            : {}),
        })
        .where("attempt_id", "=", attempt.attempt_id)
        .where("lease_token", "=", attempt.lease_token)
        .returning(["attempt_id", "evidence", "trigger_update_id"])
        .executeTakeFirst();
      if (!stored) return;
      if (confirmed)
        await tx
          .updateTable("activation_review_requests")
          .set({
            resolved_at: this.clock.now(),
            resolution: "confirmed",
            updated_at: this.clock.now(),
          })
          .where("bot_identity", "=", attempt.bot_identity)
          .where("telegram_user_id", "=", attempt.telegram_user_id)
          .where("resolved_at", "is", null)
          .execute();
      // An owner link answers for its own rule; an unconfirmed ground also goes to the owner.
      const review =
        !retry &&
        unconfirmedGround(result) &&
        !(await this.hasConfirmedGround(tx, attempt));
      if (review)
        await this.requestReview(
          tx,
          attempt,
          [{ code: attempt.code, outcome: outcomeOf(result) }],
          stored.evidence?.accountRef ?? reviewAccountRef,
        );
      if(await this.replies.hasSource(`access:${attempt.bot_identity}:${stored.trigger_update_id}`,tx)) return;
      await this.replies.enqueue(
        {
          ...this.delivery(
            this.contact({
              ...attempt,
              trigger_update_id: stored.trigger_update_id,
            }),
            review && !asksToWriteAuthor(result)
              ? `${activationMessage(result, result.ok && result.value.rule ? this.sourceName(result.value.rule.sourceRef) : undefined)}\n\n${OWNER_REVIEW}`
              : activationMessage(
                  result,
                  result.ok && result.value.rule
                    ? this.sourceName(result.value.rule.sourceRef)
                    : undefined,
                ),
          ),
          sourceKey: `activation:${createHash("sha256")
            .update(
              JSON.stringify([
                attempt.identity_ref,
                attempt.code,
                attempt.created_at.toISOString(),
                stored.trigger_update_id,
              ]),
            )
            .digest(
              "hex",
            )}:${result.ok ? (result.value.state === "pending_review" ? `pending_review:${result.value.enrollment?.state ?? "none"}` : result.value.state) : result.error.code}`,
          ...(hasText(editMessageId) ? { editMessageId } : {}),
          ...this.menu(result, attempt.code),
          ...(currentScreen ? {messageText:currentScreen.text,buttons:currentScreen.buttons} : {}),
        },
        tx,
      );
    });
  }
  /** A person with any confirmed ground has rights; a missing other ground is no news for them. */
  private async hasConfirmedGround(
    tx: Transaction<DatabaseSchema>,
    attempt: Attempt,
  ): Promise<boolean> {
    // Not the state or result: a retried confirmation is pending until Platform repeats it.
    const confirmed = await tx
      .selectFrom("activation_attempts")
      .select("attempt_id")
      .where("bot_identity", "=", attempt.bot_identity)
      .where("telegram_user_id", "=", attempt.telegram_user_id)
      .where("confirmed_at", "is not", null)
      .executeTakeFirst();
    return confirmed !== undefined;
  }
  /** One open owner review per person; a new unconfirmed check replaces its outcomes. */
  private async requestReview(
    tx: Transaction<DatabaseSchema>,
    attempt: Attempt,
    outcomes: readonly GroundOutcome[],
    /** From the stored row: the claimed attempt predates its evidence. */
    accountRef: string | undefined,
  ): Promise<void> {
    const now = this.clock.now();
    const request = {
      identity_ref: attempt.identity_ref,
      account_ref: accountRef ?? null,
      outcomes: JSON.stringify(outcomes),
      updated_at: now,
    };
    await tx
      .insertInto("activation_review_requests")
      .values({
        ...request,
        review_id: randomUUID(),
        bot_identity: attempt.bot_identity,
        telegram_user_id: attempt.telegram_user_id,
        requested_at: now,
        resolved_at: null,
        resolution: null,
      })
      .onConflict((c) =>
        c
          .columns(["bot_identity", "telegram_user_id"])
          .doUpdateSet({ ...request, resolved_at: null, resolution: null }),
      )
      .execute();
  }
  private menu(
    result?: ActivationResult<ActivationResponse>,
    code?: string,
  ): {
    buttons?: readonly TelegramButton[];
  } {
    return this.config.activation
      ? {
          buttons: activationMenu(
            this.config.activation.accountUrl,
            result,
            code,
          ),
        }
      : {};
  }
  private async defer(
    attempt: Attempt,
    code: string,
    state: "retry" | "needs_account" = "retry",
    delay = CADENCE,
  ): Promise<void> {
    await this.db
      .updateTable("activation_attempts")
      .set({
        state,
        diagnostic_code: code,
        lease_token: null,
        lease_until: null,
        due_at: new Date(this.clock.now().getTime() + delay),
      })
      .where("attempt_id", "=", attempt.attempt_id)
      .where("lease_token", "=", attempt.lease_token)
      .execute();
    if(state === "retry") await this.reply(this.contact(attempt),"Не удалось проверить доступ. Попробуйте ещё раз.",attempt.code);
  }
  private contact(attempt: Attempt): VerifiedPrivateStart {
    return {
      botIdentity: attempt.bot_identity,
      telegramUserId: attempt.telegram_user_id,
      privateChatId: attempt.private_chat_id,
      updateId: attempt.trigger_update_id,
      observedAt: this.clock.now(),
    };
  }
  private sourceName(sourceRef: string): string {
    return (
      this.config.activation?.sources.find(
        (source) => source.sourceRef === sourceRef,
      )?.name ?? sourceRef
    );
  }
  private delivery(contact: VerifiedPrivateStart, messageText: string) {
    return {
      botIdentity: contact.botIdentity,
      telegramUserId: contact.telegramUserId,
      privateChatId: contact.privateChatId,
      triggerUpdateId: contact.updateId,
      now: this.clock.now(),
      sourceKey: `access:${contact.botIdentity}:${contact.updateId}`,
      ...(hasText(contact.messageId) ? { editMessageId: contact.messageId } : {}),
      messageText,
    };
  }
  private async reply(
    contact: VerifiedPrivateStart,
    text: string,
    code?: string,
  ): Promise<void> {
    await this.replies.enqueue({
      ...this.delivery(contact, text),
      ...this.menu(undefined, code),
    });
  }
  async snapshot(): Promise<{ pending: number; oldestSeconds: number }> {
    const result = await sql<{
      count: string;
      oldest: Date | null;
    }>`select count(*)::text as count, min(created_at) as oldest from activation_attempts where bot_identity=${this.config.botIdentity} and state in ('pending','needs_account','retry')`.execute(
      this.db,
    );
    return {
      pending: Number(result.rows[0]?.count ?? 0),
      oldestSeconds: result.rows[0]?.oldest
        ? Math.max(
            0,
            (this.clock.now().getTime() - result.rows[0].oldest.getTime()) /
              1000,
          )
        : 0,
    };
  }
}

const CONFIRMED_STATES: readonly ActivationState[] = [
  "active",
  "already_active",
];

/** Platform granted, now or on an earlier attempt of the same ground. */
function confirmedResult(
  result: ActivationResult<ActivationResponse>,
): boolean {
  return result.ok && CONFIRMED_STATES.includes(result.value.state);
}

/** A ground that was checked and not confirmed, as opposed to a broken link or paused rule. */
function unconfirmedGround(
  result: ActivationResult<ActivationResponse>,
): boolean {
  return result.ok
    ? ["rejected", "pending_review"].includes(result.value.state)
    : ["source_not_confirmed", "identity_conflict"].includes(result.error.code);
}

/** What one attempt's result says, for the owner's review. */
function outcomeOf(result: ActivationResult<ActivationResponse>): string {
  return result.ok ? result.value.state : result.error.code;
}

/** A new attempt due now. */
function newAttempt(
  contact: VerifiedPrivateStart,
  identityRef: string,
  code: string,
  now: Date,
) {
  return {
    attempt_id: randomUUID(),
    bot_identity: contact.botIdentity,
    telegram_user_id: contact.telegramUserId,
    private_chat_id: contact.privateChatId,
    identity_ref: identityRef,
    code,
    trigger_update_id: contact.updateId,
    state: "pending" as const,
    evidence: null,
    source_proof: null,
    result: null,
    created_at: now,
    expires_at: new Date(now.getTime() + RETENTION),
    due_at: now,
    lease_token: null,
    lease_until: null,
    attempts: 0,
    diagnostic_code: null,
    confirmed_at: null,
  };
}

/**
 * Schedules an existing attempt again. A leased attempt keeps running; a known negative result
 * starts a fresh attempt, while an uncertain evidence write stays for its exact replay.
 */
async function reschedule(
  tx: Transaction<DatabaseSchema>,
  row: Attempt,
  now: Date,
  updateId: string,
): Promise<void> {
  // A running worker answers the latest request without losing its lease or evidence.
  if (row.lease_until !== null && row.lease_until > now) {
    await tx
      .updateTable("activation_attempts")
      .set({ trigger_update_id: updateId })
      .where("attempt_id", "=", row.attempt_id)
      .execute();
    return;
  }
  const fresh =
    row.result !== null &&
    ["rejected", "pending_review", "retry"].includes(row.state);
  await tx
    .updateTable("activation_attempts")
    .set({
      state: "pending",
      expires_at: new Date(now.getTime() + RETENTION),
      due_at: now,
      trigger_update_id: updateId,
      ...(fresh
        ? { attempt_id: randomUUID(), evidence: null, result: null }
        : {}),
    })
    .where("attempt_id", "=", row.attempt_id)
    .execute();
}
