import { createHash } from "node:crypto";
import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import { findPlatformLink } from "../identity-linking/platform-links.js";
import { parseAuthorState, type AuthorState } from "./author-dialog.js";
import type {
  NativeCaptureKind,
  NativeMessageInput,
} from "./native-message-input.js";

export interface NativeCaptureContext {
  readonly accountRef: string;
  readonly identityRef: string;
  readonly hash: string;
}

function capturesMessage(state: AuthorState): boolean {
  return (
    state.batch !== undefined ||
    state.prompt?.kind === "replace" ||
    state.composing?.prompt === "capture" ||
    (state.composing?.sequence !== undefined &&
      state.composing.content === undefined)
  );
}

/** Re-read the original mode before and after remote copying; a changed dialog cannot receive stale content. */
export async function nativeCaptureContext(
  tx: Transaction<DatabaseSchema>,
  input: NativeMessageInput,
  kind: NativeCaptureKind,
): Promise<NativeCaptureContext | undefined> {
  const link = await findPlatformLink(
    tx,
    {
      botIdentity: input.botIdentity,
      telegramUserId: input.telegramUserId,
    },
    "share",
  );
  if (!link) return;
  let context: unknown;
  if (kind === "template") {
    const mode = await tx
      .selectFrom("communication_author_modes")
      .selectAll()
      .where("bot_identity", "=", input.botIdentity)
      .where("telegram_user_id", "=", input.telegramUserId)
      .where("account_ref", "=", link.accountRef)
      .where("enabled", "=", true)
      .executeTakeFirst();
    if (!mode || BigInt(input.updateId) <= BigInt(mode.last_update_id)) return;
    context = { kind, openedAt: mode.last_update_id };
  } else {
    const session = await tx
      .selectFrom("communication_author_sessions")
      .selectAll()
      .where("bot_identity", "=", input.botIdentity)
      .where("telegram_user_id", "=", input.telegramUserId)
      .where("account_ref", "=", link.accountRef)
      .executeTakeFirst();
    const state = parseAuthorState(session?.state);
    if (!state || !capturesMessage(state)) return;
    context = { kind, state };
  }
  return {
    accountRef: link.accountRef,
    identityRef: link.telegramIdentityRef,
    hash: createHash("sha256").update(JSON.stringify(context)).digest("hex"),
  };
}
