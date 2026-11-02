import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { z } from "zod";
import {
  COMMUNITY_DISCUSSIONS_VERSION,
  communityDiscussionsRequestSchema,
  communityDiscussionsSuccessSchema,
  type CommunityDiscussionsRequest,
  type CommunityDiscussionsSuccess,
  type Discussion,
  type DiscussionErrorCode,
} from "@inside/contracts/community-discussions";
import { DATABASE, type Database } from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import {
  AUTHOR_AUTHORIZATION,
  authorizeAuthor,
  type AuthorAuthorization,
} from "../communications/author-authorization.js";
import type { DiscussionTables } from "./discussion-storage.js";

export class CommunityDiscussionsError extends Error {
  constructor(readonly code: DiscussionErrorCode) {
    super(code);
  }
}
const cursorSchema = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  filters: z.string(),
});
type Request = CommunityDiscussionsRequest;
function view(
  row: Selectable<DiscussionTables["community_discussions"]>,
): Discussion {
  return {
    discussionId: row.id,
    status: row.status,
    question: row.question,
    answers: row.answers,
    conclusion: row.conclusion,
    materialUrls: row.material_urls,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class CommunityDiscussions {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTHOR_AUTHORIZATION)
    private readonly authorization: AuthorAuthorization,
  ) {}

  async execute(input: unknown): Promise<CommunityDiscussionsSuccess> {
    const parsed = communityDiscussionsRequestSchema.safeParse(input);
    if (!parsed.success) throw new CommunityDiscussionsError("malformed");
    const request = parsed.data;
    let allowed: "allowed" | "denied" | "unavailable";
    try {
      allowed = await authorizeAuthor(this.authorization, {
        kind: "account",
        ...request.actor,
      });
    } catch {
      allowed = "unavailable";
    }
    if (allowed !== "allowed")
      throw new CommunityDiscussionsError(
        allowed === "denied" ? "forbidden" : "authorization_unavailable",
      );
    const base = {
      contractVersion: COMMUNITY_DISCUSSIONS_VERSION,
      requestId: request.requestId,
      status: "ok" as const,
    };
    let response: CommunityDiscussionsSuccess;
    if (request.operation === "discussions.list")
      response = {
        ...base,
        operation: request.operation,
        ...(await this.list(request)),
      };
    else if (request.operation === "discussions.read")
      response = {
        ...base,
        operation: request.operation,
        discussion: await this.read(request.discussionId),
      };
    else response = await this.mark(request);
    return communityDiscussionsSuccessSchema.parse(response);
  }

  private scoped(database = this.database) {
    return database
      .selectFrom("community_discussions")
      .selectAll()
      .where("bot_identity", "=", this.config.botIdentity)
      .where("chat_id", "=", this.config.canonicalChatId);
  }

  private async list(
    request: Extract<Request, { operation: "discussions.list" }>,
  ) {
    if (
      request.from !== undefined &&
      request.to !== undefined &&
      new Date(request.from) > new Date(request.to)
    )
      throw new CommunityDiscussionsError("malformed");
    const filters = JSON.stringify([
      request.status ?? null,
      request.from ?? null,
      request.to ?? null,
    ]);
    let query = this.scoped();
    if (request.status !== undefined)
      query = query.where("status", "=", request.status);
    if (request.from !== undefined)
      query = query.where("created_at", ">=", new Date(request.from));
    if (request.to !== undefined)
      query = query.where("created_at", "<=", new Date(request.to));
    if (request.cursor !== undefined) {
      let cursor: z.infer<typeof cursorSchema>;
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new CommunityDiscussionsError("malformed");
      }
      if (cursor.filters !== filters)
        throw new CommunityDiscussionsError("malformed");
      const instant = new Date(cursor.createdAt);
      query = query.where((eb) =>
        eb.or([
          eb("created_at", ">", instant),
          eb.and([eb("created_at", "=", instant), eb("id", ">", cursor.id)]),
        ]),
      );
    }
    const rows = await query
      .orderBy("created_at")
      .orderBy("id")
      .limit(request.limit + 1)
      .execute();
    const page = rows.slice(0, request.limit);
    const last = page.at(-1);
    return {
      items: page.map(view),
      nextCursor:
        rows.length > request.limit && last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.created_at.toISOString(),
                id: last.id,
                filters,
              }),
            ).toString("base64url")
          : null,
    };
  }

  private async read(id: string) {
    const row = await this.scoped().where("id", "=", id).executeTakeFirst();
    if (!row) throw new CommunityDiscussionsError("not_found");
    const sources = await this.database
      .selectFrom("community_discussion_sources as source")
      .leftJoin("community_messages as message", (join) =>
        join
          .onRef("source.bot_identity", "=", "message.bot_identity")
          .onRef("source.chat_id", "=", "message.chat_id")
          .onRef("source.message_id", "=", "message.message_id"),
      )
      .select([
        "source.message_id",
        "source.thread_id",
        "source.reply_to_message_id",
        "source.sent_at",
        "source.role",
        "source.kind",
        "source.source_url",
        "message.text",
      ])
      .where("source.discussion_id", "=", id)
      .where("source.bot_identity", "=", this.config.botIdentity)
      .where("source.chat_id", "=", this.config.canonicalChatId)
      .orderBy("source.message_id")
      .execute();
    return {
      ...view(row),
      messages: sources.map((source) => ({
        messageId: source.message_id,
        threadId: source.thread_id,
        replyToMessageId: source.reply_to_message_id,
        sentAt: source.sent_at.toISOString(),
        role: source.role,
        kind: source.kind,
        sourceUrl: source.source_url,
        text: source.text,
      })),
    };
  }

  private async mark(
    request: Extract<Request, { operation: "discussions.mark" }>,
  ): Promise<CommunityDiscussionsSuccess> {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          request.discussionId,
          request.status,
          request.materialUrls,
        ]),
      )
      .digest("hex");
    return this.database.transaction().execute(async (tx) => {
      // Serializes receipt replay and status writes, including concurrent requests for different discussions.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`community-discussion-mark:${this.config.botIdentity}:${request.actor.accountRef}:${request.requestId}`}, 0))`.execute(
        tx,
      );
      const receipt = await tx
        .selectFrom("community_discussion_mark_receipts")
        .selectAll()
        .where("bot_identity", "=", this.config.botIdentity)
        .where("account_ref", "=", request.actor.accountRef)
        .where("request_id", "=", request.requestId)
        .executeTakeFirst();
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new CommunityDiscussionsError("operation_conflict");
        return receipt.response;
      }
      const row = await tx
        .updateTable("community_discussions")
        .set({
          status: request.status,
          material_urls: JSON.stringify(request.materialUrls),
          updated_at: this.clock.now(),
        })
        .where("id", "=", request.discussionId)
        .where("bot_identity", "=", this.config.botIdentity)
        .where("chat_id", "=", this.config.canonicalChatId)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new CommunityDiscussionsError("not_found");
      const response: CommunityDiscussionsSuccess = {
        contractVersion: COMMUNITY_DISCUSSIONS_VERSION,
        requestId: request.requestId,
        operation: request.operation,
        status: "ok",
        discussion: view(row),
      };
      await tx
        .insertInto("community_discussion_mark_receipts")
        .values({
          bot_identity: this.config.botIdentity,
          account_ref: request.actor.accountRef,
          request_id: request.requestId,
          fingerprint,
          response: JSON.stringify(response),
        })
        .execute();
      return response;
    });
  }
}
