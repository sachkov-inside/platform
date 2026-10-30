import { CLOCK, systemClock, type Clock } from "../../shared/clock.js";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import type { Selectable, Transaction } from "kysely";
import {
  DATABASE,
  type Database,
  type DatabaseSchema,
} from "../../database/database.js";
import { transactionWithExternalReads } from "../../database/external-reads.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import {
  reserveTelegramSlot,
  deferTelegramSlot,
} from "../outbound/telegram-transport-slots.js";
import { enqueueReply } from "../outbound/start-response-delivery-queue.js";
import {
  AUTHOR_AUTHORIZATION,
  authorizeAuthor,
  type AuthorAuthorization,
} from "./author-authorization.js";
import { communicationLock } from "./communication-state.js";
import {
  CommunicationsError,
  requiredField,
  validateContent,
  type TemplateContent,
} from "./communications-contract.js";
import {
  NATIVE_MESSAGE_COPY,
  type NativeMessageCopy,
  type NativeCopyCommand,
  type NativeCopyResult,
} from "./native-message-copy.js";
import {
  nativeCaptureContext,
  type NativeCaptureContext,
} from "./native-message-context.js";
import {
  matchesNativeContent,
  nativeContent,
} from "./native-message-content.js";
import type {
  NativeCaptureGuard,
  NativeCaptureKind,
  NativeMessageInput,
} from "./native-message-input.js";

const copyClaimTimeoutMilliseconds = 60_000;
const copyRetryDelaySeconds = 5;
const maximumCopyAttempts = 3;
type Tx = Transaction<DatabaseSchema>;
type CopyRow = Selectable<DatabaseSchema["communication_native_copies"]>;
export type NativePreparation =
  | { readonly kind: "skip" }
  | { readonly kind: "waiting"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly content: TemplateContent;
      readonly guard: NativeCaptureGuard;
    };
type Staged =
  NativePreparation | { readonly kind: "copy"; readonly row: CopyRow };

/** Owns capture, private-copy lifecycle and opaque references used by every communications caller. */
@Injectable()
export class NativeMessages {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(AUTHOR_AUTHORIZATION)
    private readonly authorization: AuthorAuthorization,
    @Inject(NATIVE_MESSAGE_COPY) private readonly copy: NativeMessageCopy,
    @Inject(CLOCK) private readonly clock: Clock = systemClock,
  ) {}

  async prepare(
    input: NativeMessageInput,
    kind: NativeCaptureKind,
  ): Promise<NativePreparation> {
    if (
      this.config.deliveryMode !== "live" ||
      input.nativeCapture ||
      (!input.nativeSource && input.text !== "/done") ||
      input.botIdentity !== this.config.botIdentity ||
      input.privateChatId !== input.telegramUserId
    )
      return { kind: "skip" };
    const staged = await transactionWithExternalReads(
      this.database,
      async (tx): Promise<Staged> => {
        await communicationLock(
          tx,
          `native-capture:${input.botIdentity}:${input.telegramUserId}`,
        );
        const prior =
          kind === "template"
            ? await tx
                .selectFrom("communication_intake_receipts")
                .select("update_id")
                .where("bot_identity", "=", input.botIdentity)
                .where("update_id", "=", input.updateId)
                .executeTakeFirst()
            : await tx
                .selectFrom("communication_author_receipts")
                .select("update_id")
                .where("bot_identity", "=", input.botIdentity)
                .where("update_id", "=", input.updateId)
                .executeTakeFirst();
        if (prior) return { kind: "skip" };
        const context = await nativeCaptureContext(tx, input, kind);
        if (!context) return { kind: "skip" };
        const permission = await authorizeAuthor(this.authorization, {
          kind: "telegram",
          accountRef: context.accountRef,
          telegramIdentityRef: context.identityRef,
          botIdentity: input.botIdentity,
        });
        if (permission === "unavailable")
          throw new CommunicationsError("authorization_unavailable");
        if (permission !== "allowed") return { kind: "skip" };
        return this.stage(tx, input, kind, context);
      },
    );
    if (staged.kind !== "copy") return staged;
    let result: NativeCopyResult;
    try {
      result = await this.copy.copy({
        chatId: input.privateChatId,
        sourceChatId: input.privateChatId,
        messageIds: staged.row.sources.map((source) => source.messageId),
        buttons: nativeContent(staged.row.archive_id, staged.row.sources)
          .buttons,
      });
    } catch {
      result = { kind: "transport_unknown" };
    }
    return this.finish(staged.row, result);
  }

  async report(input: NativeMessageInput, message: string): Promise<void> {
    await this.database.transaction().execute((tx) =>
      enqueueReply(tx, {
        botIdentity: input.botIdentity,
        telegramUserId: input.telegramUserId,
        privateChatId: input.privateChatId,
        messageText: message,
        sourceKey: `native-capture:${input.botIdentity}:${input.updateId}`,
        now: this.clock.now(),
      }),
    );
  }

  async guardMatches(
    tx: Tx,
    input: NativeMessageInput,
    accountRef: string,
  ): Promise<boolean> {
    const guard = input.nativeCapture;
    if (!guard) return true;
    const context = await nativeCaptureContext(tx, input, guard.kind);
    const copy = await tx
      .selectFrom("communication_native_copies")
      .selectAll()
      .where("archive_id", "=", guard.archiveRef)
      .where("bot_identity", "=", input.botIdentity)
      .where("owner_account_ref", "=", accountRef)
      .where("telegram_user_id", "=", input.telegramUserId)
      .executeTakeFirst();
    return (
      context?.accountRef === accountRef &&
      context.hash === guard.contextHash &&
      copy?.context_hash === guard.contextHash &&
      copy.state === "ready" &&
      copy.telegram_identity_ref === context.identityRef
    );
  }

  async assertOwned(
    tx: Tx,
    accountRef: string,
    contents: readonly TemplateContent[],
  ): Promise<void> {
    for (const content of contents) {
      if (content.type !== "native") continue;
      const row = await tx
        .selectFrom("communication_native_copies")
        .selectAll()
        .where("archive_id", "=", requiredField(content.nativeRef))
        .where("bot_identity", "=", this.config.botIdentity)
        .where("owner_account_ref", "=", accountRef)
        .executeTakeFirst();
      if (!row) throw new CommunicationsError("not_found");
      if (
        row.state !== "ready" ||
        !matchesNativeContent(content, row.sources) ||
        (row.sources.length > 1 && content.buttons.length > 0)
      )
        throw new CommunicationsError("unsupported_content");
    }
  }

  async resolve(
    content: TemplateContent,
    chatId: string,
  ): Promise<NativeCopyCommand | undefined> {
    validateContent(content);
    if (content.type !== "native" || content.nativeRef === undefined) return;
    const row = await this.database
      .selectFrom("communication_native_copies")
      .selectAll()
      .where("archive_id", "=", content.nativeRef)
      .where("bot_identity", "=", this.config.botIdentity)
      .where("state", "=", "ready")
      .executeTakeFirst();
    if (
      !row ||
      !matchesNativeContent(content, row.sources) ||
      row.copied_message_ids.length !== row.sources.length
    )
      return;
    return {
      chatId,
      sourceChatId: row.telegram_user_id,
      messageIds: row.copied_message_ids,
      buttons: content.buttons,
    };
  }

  private async stage(
    tx: Tx,
    input: NativeMessageInput,
    kind: NativeCaptureKind,
    context: NativeCaptureContext,
  ): Promise<Staged> {
    let row = await tx
      .selectFrom("communication_native_copies")
      .selectAll()
      .where("bot_identity", "=", input.botIdentity)
      .where("telegram_user_id", "=", input.telegramUserId)
      .where("context_kind", "=", kind)
      .where("context_hash", "=", context.hash)
      .forUpdate()
      .executeTakeFirst();
    const source = input.nativeSource;
    const now = this.clock.now();
    if (!row) {
      if (!source)
        return {
          kind: "waiting",
          message: "Нет альбома или сообщения, ожидающего сохранения.",
        };
      const archiveRef = randomUUID();
      validateContent(nativeContent(archiveRef, [source]));
      row = await tx
        .insertInto("communication_native_copies")
        .values({
          archive_id: archiveRef,
          bot_identity: input.botIdentity,
          owner_account_ref: context.accountRef,
          telegram_user_id: input.telegramUserId,
          telegram_identity_ref: context.identityRef,
          context_kind: kind,
          context_hash: context.hash,
          media_group_id: source.mediaGroupId ?? null,
          sources: JSON.stringify([source]),
          copied_message_ids: "[]",
          state: source.mediaGroupId !== undefined ? "collecting" : "pending",
          created_at: now,
          attempted_at: null,
          available_at: now,
          attempt_count: 0,
          diagnostic_code: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } else if (source) {
      const previous = row.sources.find(
        (item) => item.messageId === source.messageId,
      );
      if (previous && !isDeepStrictEqual(previous, source))
        throw new CommunicationsError("operation_conflict");
      if (!previous) {
        if (
          row.state !== "collecting" ||
          source.mediaGroupId !== row.media_group_id
        )
          return {
            kind: "waiting",
            message:
              "Сначала завершите сохранение предыдущего сообщения: /done. Для нового поста можно выйти через /cancel.",
          };
        if (row.sources.length >= 10)
          return {
            kind: "waiting",
            message:
              "В альбоме уже 10 сообщений. Завершите сохранение командой /done.",
          };
        const sources = [...row.sources, source].sort(
          (a, b) => a.messageId - b.messageId,
        );
        validateContent(nativeContent(row.archive_id, sources));
        row = await tx
          .updateTable("communication_native_copies")
          .set({ sources: JSON.stringify(sources) })
          .where("archive_id", "=", row.archive_id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }
    }
    if (
      row.owner_account_ref !== context.accountRef ||
      row.telegram_identity_ref !== context.identityRef
    )
      throw new CommunicationsError("not_found");
    if (row.state === "ready") return ready(row);
    if (row.state === "unknown" || row.state === "rejected") return status(row);
    if (row.state === "sending") {
      if (
        row.attempted_at &&
        now.getTime() - row.attempted_at.getTime() >=
          copyClaimTimeoutMilliseconds
      ) {
        row = await tx
          .updateTable("communication_native_copies")
          .set({ state: "unknown", diagnostic_code: "expired_claim" })
          .where("archive_id", "=", row.archive_id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return status(row);
      }
      return {
        kind: "waiting",
        message:
          "Копия ещё сохраняется. Подождите немного, затем повторите /done.",
      };
    }
    if (row.state === "collecting" && input.text !== "/done")
      return {
        kind: "waiting",
        message: `В альбоме принято сообщений: ${row.sources.length}. Когда загрузка завершится, отправьте /done.`,
      };
    if (
      row.available_at > now ||
      !(await reserveTelegramSlot(
        tx,
        input.botIdentity,
        input.telegramUserId,
        now,
      ))
    )
      return {
        kind: "waiting",
        message:
          "Сохранение отложено из-за ограничения Telegram. Повторите /done немного позже.",
      };
    const claimed = await tx
      .updateTable("communication_native_copies")
      .set({
        state: "sending",
        attempted_at: now,
        attempt_count: row.attempt_count + 1,
      })
      .where("archive_id", "=", row.archive_id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { kind: "copy", row: claimed };
  }

  private async finish(
    row: CopyRow,
    result: NativeCopyResult,
  ): Promise<NativePreparation> {
    return this.database.transaction().execute(async (tx) => {
      const success =
        result.kind === "delivered" &&
        result.messageIds.length === row.sources.length;
      const retry =
        result.kind === "api_retryable" &&
        row.attempt_count < maximumCopyAttempts;
      const availableAt = new Date(
        this.clock.now().getTime() +
          (result.kind === "api_retryable"
            ? (result.retryAfterSeconds ?? copyRetryDelaySeconds) * 1000
            : 0),
      );
      const updated = await tx
        .updateTable("communication_native_copies")
        .set({
          state: success
            ? "ready"
            : result.kind === "transport_unknown" ||
                result.kind === "partial" ||
                result.kind === "delivered"
              ? "unknown"
              : retry
                ? "pending"
                : "rejected",
          copied_message_ids: JSON.stringify(
            result.kind === "delivered" || result.kind === "partial"
              ? result.messageIds
              : [],
          ),
          diagnostic_code: result.kind,
          available_at: availableAt,
        })
        .where("archive_id", "=", row.archive_id)
        .where("state", "=", "sending")
        .where("attempt_count", "=", row.attempt_count)
        .returningAll()
        .executeTakeFirst();
      if (result.kind === "api_retryable" && result.providerErrorCode === 429)
        await deferTelegramSlot(tx, row.bot_identity, availableAt);
      if (!updated)
        return {
          kind: "waiting",
          message:
            "Состояние сохранения изменилось. Проверьте переписку и повторите /done.",
        };
      return success ? ready(updated) : status(updated);
    });
  }
}

function ready(row: CopyRow): NativePreparation {
  return {
    kind: "ready",
    content: nativeContent(row.archive_id, row.sources),
    guard: {
      archiveRef: row.archive_id,
      contextHash: row.context_hash,
      kind: row.context_kind,
    },
  };
}
function status(row: CopyRow): NativePreparation {
  if (row.state === "unknown")
    return {
      kind: "waiting",
      message:
        "Не удалось подтвердить полное сохранение копии. Автоматического повтора не будет. Проверьте сообщения бота; для нового сохранения выйдите через /cancel и откройте /template или /admin.",
    };
  if (row.state === "pending")
    return {
      kind: "waiting",
      message:
        "Telegram временно отклонил сохранение. Повторите /done немного позже.",
    };
  return {
    kind: "waiting",
    message:
      "Telegram отклонил копирование сообщения. Заготовка не сохранена. Выйдите через /cancel и начните сохранение заново.",
  };
}
