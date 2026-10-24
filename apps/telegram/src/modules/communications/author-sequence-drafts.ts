import { hasText } from "../../shared/text.js";
import { randomUUID } from "node:crypto";
import type { Context } from "./author-admin.js";
import {
  parseSequenceDraft,
  type AuthorSequenceState,
} from "./author-dialog.js";
import { drafts } from "./author-drafts.js";
import { authorRequest } from "./author-request.js";
import type { SequenceListItem } from "./author-turn.js";
import { CommunicationsError } from "./communications-contract.js";
import type { CommunicationSequences } from "./communication-sequences.js";

/**
 * Reads the author's sequences and shared intro, preferring an unsaved draft to the saved version,
 * and the delivery history of their steps.
 */
export class AuthorSequenceDrafts {
  constructor(private readonly sequences: CommunicationSequences) {}

  /** A page of the author's sequences, saved ones and unsaved drafts together. */
  async list(
    c: Context,
    cursor: string | undefined,
  ): Promise<{ items: SequenceListItem[]; nextCursor?: string | undefined }> {
    let saved = c.tx
      .selectFrom("communication_sequences")
      .select("sequence_id as id")
      .where("bot_identity", "=", c.input.botIdentity)
      .where("owner_account_ref", "=", c.accountRef);
    let scratch = c.tx
      .selectFrom("communication_author_drafts")
      .select("draft_id as id")
      .where("bot_identity", "=", c.input.botIdentity)
      .where("owner_account_ref", "=", c.accountRef)
      .where("kind", "=", "sequence");
    if (hasText(cursor)) {
      saved = saved.where("sequence_id", ">", cursor);
      scratch = scratch.where("draft_id", ">", cursor);
    }
    const ids = await saved.union(scratch).orderBy("id").limit(11).execute();
    const pageIds = ids.slice(0, 10).map((row) => row.id);
    if (pageIds.length === 0) return { items: [], nextCursor: undefined };
    // Context already contains the linked author authorized by AuthorAdmin.
    const savedRows = await c.tx
      .selectFrom("communication_sequences")
      .select(["sequence_id", "draft", "lifecycle"])
      .where("bot_identity", "=", c.input.botIdentity)
      .where("owner_account_ref", "=", c.accountRef)
      .where("sequence_id", "in", pageIds)
      .execute();
    const draftRows = await drafts(c)
      .where("kind", "=", "sequence")
      .where("draft_id", "in", pageIds)
      .execute();
    const savedById = new Map(savedRows.map((row) => [row.sequence_id, row]));
    const draftsById = new Map(draftRows.map((row) => [row.draft_id, row]));
    const items: SequenceListItem[] = pageIds.map((id) => {
      const draft = draftsById.get(id);
      if (draft) return { id, name: draft.name, status: "edited" };
      const row = savedById.get(id);
      if (!row) throw new CommunicationsError("not_found");
      return { id, name: row.draft.name, status: row.lifecycle };
    });
    return { items, nextCursor: ids.length > 10 ? ids[9]?.id : undefined };
  }

  async read(c: Context, sequenceId: string): Promise<AuthorSequenceState> {
    const draft = await drafts(c)
      .where("draft_id", "=", sequenceId)
      .where("kind", "=", "sequence")
      .executeTakeFirst();
    const snapshot = parseSequenceDraft(draft?.snapshot);
    if (snapshot) return snapshot;
    const result = await this.sequences.execute(
      authorRequest(c.accountRef, "sequences.read", { sequenceId }),
      c.tx,
    );
    if (!("sequence" in result)) throw new CommunicationsError("malformed");
    return { sequence: result.sequence, dirty: false };
  }

  /** The shared intro; a new empty one when the author has none yet. */
  async readIntro(c: Context): Promise<AuthorSequenceState> {
    const draft = await drafts(c)
      .where("kind", "=", "intro")
      .executeTakeFirst();
    const snapshot = parseSequenceDraft(draft?.snapshot);
    if (snapshot) return snapshot;
    try {
      const result = await this.sequences.execute(
        authorRequest(c.accountRef, "intro.read", {}),
        c.tx,
      );
      if (!("intro" in result)) throw new CommunicationsError("malformed");
      return { intro: result.intro, target: "intro", dirty: false };
    } catch (error) {
      if (!(error instanceof CommunicationsError) || error.code !== "not_found")
        throw error;
      return {
        intro: { introId: randomUUID(), revision: 0, parts: [] },
        target: "intro",
        dirty: false,
      };
    }
  }

  /** Whether any published version of the sequence already delivered this message. */
  async wasPublished(
    c: Context,
    sequenceId: string,
    partId: string,
  ): Promise<boolean> {
    const historical = await c.tx
      .selectFrom("communication_step_ids")
      .select("part_ids")
      .where("sequence_id", "=", sequenceId)
      .execute();
    return historical.some((step) => step.part_ids.includes(partId));
  }
}
