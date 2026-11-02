import { z } from "zod";

export const COMMUNITY_DISCUSSIONS_VERSION = "inside.community-discussions.v1" as const;
export const discussionStatusSchema: z.ZodEnum<{ new: "new"; awaiting_answer: "awaiting_answer"; reviewed: "reviewed"; used: "used" }> = z.enum(["new", "awaiting_answer", "reviewed", "used"]);
export type DiscussionStatus = z.infer<typeof discussionStatusSchema>;
const actor: z.ZodObject<{ accountRef: z.ZodString }, z.core.$strict> = z.strictObject({ accountRef: z.string().min(1).max(200) });
const common: { contractVersion: z.ZodLiteral<"inside.community-discussions.v1">; requestId: z.ZodString; actor: typeof actor } = {
  contractVersion: z.literal(COMMUNITY_DISCUSSIONS_VERSION),
  requestId: z.string().min(1).max(200), actor,
};
const list: z.ZodObject<typeof common & { operation: z.ZodLiteral<"discussions.list">; status: z.ZodOptional<typeof discussionStatusSchema>; from: z.ZodOptional<z.ZodISODateTime>; to: z.ZodOptional<z.ZodISODateTime>; limit: z.ZodNumberFormat; cursor: z.ZodOptional<z.ZodString> }, z.core.$strict> = z.strictObject({ ...common, operation: z.literal("discussions.list"), status: discussionStatusSchema.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), limit: z.int().min(1).max(100), cursor: z.string().min(1).max(2000).optional() });
const read: z.ZodObject<typeof common & { operation: z.ZodLiteral<"discussions.read">; discussionId: z.ZodUUID }, z.core.$strict> = z.strictObject({ ...common, operation: z.literal("discussions.read"), discussionId: z.uuid() });
const mark: z.ZodObject<typeof common & { operation: z.ZodLiteral<"discussions.mark">; discussionId: z.ZodUUID; status: typeof discussionStatusSchema; materialUrls: z.ZodArray<z.ZodURL> }, z.core.$strict> = z.strictObject({ ...common, operation: z.literal("discussions.mark"), discussionId: z.uuid(), status: discussionStatusSchema, materialUrls: z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(20) }).refine((request) => (request.status === "used") === (request.materialUrls.length > 0), "Only used discussions require material URLs");
export const communityDiscussionsRequestSchema: z.ZodDiscriminatedUnion<[typeof list, typeof read, typeof mark], "operation"> = z.discriminatedUnion("operation", [list, read, mark]);
export type CommunityDiscussionsRequest = z.infer<typeof communityDiscussionsRequestSchema>;

export const discussionSchema: z.ZodObject<{
  discussionId: z.ZodUUID; status: typeof discussionStatusSchema;
  question: z.ZodString; answers: z.ZodString; conclusion: z.ZodString;
  createdAt: z.ZodISODateTime; updatedAt: z.ZodISODateTime;
  materialUrls: z.ZodArray<z.ZodURL>;
}, z.core.$strict> = z.strictObject({
  discussionId: z.uuid(), status: discussionStatusSchema,
  question: z.string().min(1).max(4000), answers: z.string().max(12000), conclusion: z.string().max(4000),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
  materialUrls: z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(20),
});
export type Discussion = z.infer<typeof discussionSchema>;
export const discussionMessageSchema: z.ZodObject<{
  messageId: z.ZodString; threadId: z.ZodNullable<z.ZodString>; replyToMessageId: z.ZodNullable<z.ZodString>;
  sentAt: z.ZodISODateTime; role: z.ZodString; kind: z.ZodString;
  text: z.ZodNullable<z.ZodString>; sourceUrl: z.ZodURL;
}, z.core.$strict> = z.strictObject({
  messageId: z.string().min(1).max(30), threadId: z.string().nullable(), replyToMessageId: z.string().nullable(),
  sentAt: z.iso.datetime({ offset: true }), role: z.string().min(1).max(100), kind: z.string().min(1).max(30),
  text: z.string().nullable(), sourceUrl: z.url({ protocol: /^https?$/ }).max(2000),
});
export type DiscussionMessage = z.infer<typeof discussionMessageSchema>;
const detail: z.ZodObject<typeof discussionSchema.shape & { messages: z.ZodArray<typeof discussionMessageSchema> }, z.core.$strict> = discussionSchema.extend({ messages: z.array(discussionMessageSchema) });
const responseCommon: { contractVersion: z.ZodLiteral<"inside.community-discussions.v1">; requestId: z.ZodString; status: z.ZodLiteral<"ok"> } = { contractVersion: z.literal(COMMUNITY_DISCUSSIONS_VERSION), requestId: z.string().min(1).max(200), status: z.literal("ok") };
const listed: z.ZodObject<typeof responseCommon & { operation: z.ZodLiteral<"discussions.list">; items: z.ZodArray<typeof discussionSchema>; nextCursor: z.ZodNullable<z.ZodString> }, z.core.$strict> = z.strictObject({ ...responseCommon, operation: z.literal("discussions.list"), items: z.array(discussionSchema).max(100), nextCursor: z.string().nullable() });
const readResponse: z.ZodObject<typeof responseCommon & { operation: z.ZodLiteral<"discussions.read">; discussion: typeof detail }, z.core.$strict> = z.strictObject({ ...responseCommon, operation: z.literal("discussions.read"), discussion: detail });
const marked: z.ZodObject<typeof responseCommon & { operation: z.ZodLiteral<"discussions.mark">; discussion: typeof discussionSchema }, z.core.$strict> = z.strictObject({ ...responseCommon, operation: z.literal("discussions.mark"), discussion: discussionSchema });
export const communityDiscussionsSuccessSchema: z.ZodDiscriminatedUnion<[typeof listed, typeof readResponse, typeof marked], "operation"> = z.discriminatedUnion("operation", [listed, readResponse, marked]);
export type CommunityDiscussionsSuccess = z.infer<typeof communityDiscussionsSuccessSchema>;
export const discussionErrorCodeSchema: z.ZodEnum<{ unauthorized: "unauthorized"; forbidden: "forbidden"; authorization_unavailable: "authorization_unavailable"; malformed: "malformed"; not_found: "not_found"; operation_conflict: "operation_conflict" }> = z.enum(["unauthorized", "forbidden", "authorization_unavailable", "malformed", "not_found", "operation_conflict"]);
export type DiscussionErrorCode = z.infer<typeof discussionErrorCodeSchema>;
export const communityDiscussionsErrorSchema: z.ZodObject<{ contractVersion: z.ZodLiteral<"inside.community-discussions.v1">; status: typeof discussionErrorCodeSchema }, z.core.$strict> = z.strictObject({ contractVersion: z.literal(COMMUNITY_DISCUSSIONS_VERSION), status: discussionErrorCodeSchema });
