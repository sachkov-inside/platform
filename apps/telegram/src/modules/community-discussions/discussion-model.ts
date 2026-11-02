import { z } from "zod";

export const COMMUNITY_DISCUSSION_MODEL = Symbol("COMMUNITY_DISCUSSION_MODEL");
export const groupingOutputSchema = z.strictObject({
  discussions: z
    .array(
      z.strictObject({
        discussionId: z.uuid().nullable(),
        messageIds: z.array(z.string().min(1).max(30)).min(1).max(200),
        question: z.string().min(1).max(4000),
        answers: z.string().max(12000),
        conclusion: z.string().max(4000),
        answered: z.boolean(),
      }),
    )
    .max(200),
});
export type GroupingOutput = z.infer<typeof groupingOutputSchema>;
export interface ModelUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}
export interface ModelMessage {
  readonly messageId: string;
  readonly threadId: string | null;
  readonly replyToMessageId: string | null;
  readonly sentAt: string;
  readonly role: string;
  readonly kind: string;
  readonly text: string;
}
export interface GroupInput {
  readonly messages: readonly ModelMessage[];
  readonly discussions: readonly {
    readonly discussionId: string;
    readonly question: string;
    readonly answers: string;
    readonly conclusion: string;
    readonly messageIds: readonly string[];
  }[];
}
export type GroupResult = GroupingOutput & { readonly usage: ModelUsage };
/** One model boundary owns grouping and transcription. Audio is enabled by #1955. */
export interface CommunityDiscussionModel {
  group(input: GroupInput, signal?: AbortSignal): Promise<GroupResult>;
  transcribe(
    input: { readonly bytes: Uint8Array; readonly mediaType: string },
    signal?: AbortSignal,
  ): Promise<{ readonly text: string; readonly usage: ModelUsage }>;
}
export class DisabledCommunityDiscussionModel implements CommunityDiscussionModel {
  group(): Promise<GroupResult> {
    return Promise.reject(new Error("Discussion grouping is not configured"));
  }
  transcribe(): Promise<{ readonly text: string; readonly usage: ModelUsage }> {
    return Promise.reject(
      new Error("Discussion transcription is not configured"),
    );
  }
}
