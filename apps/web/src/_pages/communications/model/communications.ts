import { z } from "zod";

const id = z.guid();
const revision = z.number().int().nonnegative();
const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
const contentFields = z.object({
  text: z.string().max(4096),
  entities: z.array(
    z
      .object({
        type: z.enum([
          "mention",
          "hashtag",
          "cashtag",
          "bot_command",
          "url",
          "email",
          "phone_number",
          "bold",
          "italic",
          "underline",
          "strikethrough",
          "spoiler",
          "code",
          "pre",
          "text_link",
          "blockquote",
          "expandable_blockquote",
        ]),
        offset: z.number().int().nonnegative(),
        length: z.number().int().positive(),
        url: httpsUrl.optional(),
        language: z.string().optional(),
      })
      .transform(({ url, language, ...entity }) => ({
        ...entity,
        ...(url === undefined ? {} : { url }),
        ...(language === undefined ? {} : { language }),
      })),
  ),
  buttons: z
    .array(z.object({ text: z.string().min(1).max(64), url: httpsUrl }))
    .max(20),
});
export const contentSchema = z.discriminatedUnion("type", [
  contentFields.extend({
    type: z.literal("text"),
    text: z.string().min(1).max(4096),
  }),
  ...(["photo", "video", "video_note", "voice", "document"] as const).map(
    (type) =>
      contentFields.extend({
        type: z.literal(type),
        fileId: z.string().min(1),
        text: z.string().max(type === "video_note" ? 0 : 1024),
      }),
  ),
]);
export const partSchema = z.object({ partId: id, content: contentSchema });
export const stepSchema = z.object({
  stepId: id,
  delaySeconds: z.number().int().nonnegative().max(2147483647),
  parts: z.array(partSchema).min(1).max(20),
});
export const draftSchema = z.object({
  funnelId: id,
  name: z.string().trim().min(1).max(128),
  isDefault: z.boolean(),
  entryResponse: z.object({
    stepId: id,
    parts: z.array(partSchema).min(1).max(100),
  }),
  steps: z.array(stepSchema).max(100),
  sources: z
    .array(
      z.object({
        sourceId: id,
        name: z.string().trim().min(1).max(128),
        code: z.string().min(3).max(42),
      }),
    )
    .max(100),
});
export const funnelSchema = draftSchema.extend({
  revision,
  publishedRevision: revision.nullable(),
  lifecycle: z.enum(["draft", "published", "paused", "archived"]),
});
export const introSchema = z.object({
  introId: id,
  revision,
  parts: z.array(partSchema).min(1).max(100),
});
export const previewSchema = z.object({
  funnelId: id,
  revision,
  addedStepIds: z.array(id),
  editedStepIds: z.array(id),
  deletedStepIds: z.array(id),
  reorderedStepIds: z.array(id),
  eligibleContacts: z.number().int().nonnegative(),
  completedParticipantsReceivingNewSteps: z.number().int().nonnegative(),
  targetErrors: z.array(
    z.object({
      url: z.url(),
      targetId: id.nullable(),
      reason: z.enum(["not_found", "not_published", "not_free", "incomplete"]),
    }),
  ),
  validationErrors: z.array(
    z.object({
      target: z.object({ kind: z.enum(["material", "series"]), targetId: id }),
      reason: z.enum(["not_found", "not_published", "not_free", "incomplete"]),
    }),
  ),
});
export const deliverySchema = z.object({
  deliveryId: id,
  revision,
  contactId: id,
  stepId: id.nullable(),
  publishedRevision: revision,
  snapshot: z.array(partSchema),
  cancelRequested: z.boolean(),
  completedAt: z.string().nullable(),
  parts: z.array(
    z.object({
      partId: id,
      state: z.enum([
        "pending",
        "in_flight",
        "sent",
        "failed",
        "unknown",
        "suppressed",
        "skipped",
        "cancelled",
      ]),
      diagnosticCode: z.string().nullable(),
      attempts: z.array(
        z.object({
          attemptId: id,
          attemptedAt: z.string(),
          outcome: z.enum(["sent", "api_rejected", "retryable", "unknown"]),
          diagnosticCode: z.string().nullable(),
          duplicateRiskAccepted: z.boolean(),
        }),
      ),
    }),
  ),
});
export const failureSchema = z.object({
  kind: z.literal("error"),
  code: z.enum([
    "unauthorized",
    "forbidden",
    "link_required",
    "conflict",
    "invalid",
    "not_found",
    "unavailable",
    "not_implemented",
  ]),
});
export type Failure = z.infer<typeof failureSchema>;
export function resultSchema<S extends z.ZodType>(schema: S) {
  return z.union([
    z.object({ kind: z.literal("ready"), value: schema }),
    failureSchema,
  ]);
}
export type Result<T> = { kind: "ready"; value: T } | Failure;
export const funnelListSchema = z.object({
  funnels: z.array(funnelSchema),
  nextCursor: z.string().nullable(),
  botStartUrl: httpsUrl,
});
export const deliveryListSchema = z.object({
  deliveries: z.array(deliverySchema),
  nextCursor: z.string().nullable(),
});
export const templateSchema = z.object({
  templateId: id,
  revision,
  content: contentSchema,
});
export type Funnel = z.infer<typeof funnelSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type Part = z.infer<typeof partSchema>;
export type Intro = z.infer<typeof introSchema>;
export type Preview = z.infer<typeof previewSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type Template = z.infer<typeof templateSchema>;
export const commandSchema = z.object({
  operationId: id,
  expectedRevision: revision,
  funnelId: id,
});
export type FunnelCommand = z.infer<typeof commandSchema>;
export const saveSchema = z.object({
  operationId: id,
  expectedRevision: revision,
  draft: draftSchema,
});
export type SaveFunnel = z.infer<typeof saveSchema>;
export const lifecycleSchema = commandSchema.extend({
  action: z.enum(["pause", "resume", "archive", "restore"]),
});
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export const rollbackSchema = commandSchema.extend({
  publishedRevision: revision.positive(),
});
export type Rollback = z.infer<typeof rollbackSchema>;
export const saveIntroSchema = z.object({
  operationId: id,
  expectedRevision: revision,
  introId: id,
  parts: z.array(partSchema).min(1).max(100),
});
export type SaveIntro = z.infer<typeof saveIntroSchema>;
export const resolveDeliverySchema = z.object({
  operationId: id,
  expectedRevision: revision,
  deliveryId: id,
  partId: id,
  duplicateRiskAccepted: z.boolean(),
});
export type ResolveDelivery = z.infer<typeof resolveDeliverySchema>;
export const templateReferenceSchema = z.object({
  operationId: id,
  reference: z.string().min(1).max(2048),
});
export type TemplateReference = z.infer<typeof templateReferenceSchema>;
export const messages: Record<Failure["code"], string> = {
  unauthorized: "Войдите в аккаунт, чтобы управлять воронками.",
  forbidden:
    "Нет права управления коммуникациями. Доступ к материалам не даёт это право.",
  link_required: "Свяжите Telegram с аккаунтом в настройках профиля.",
  conflict:
    "Состояние изменилось в другой сессии. Ваши правки сохранены на экране. Загрузите актуальное состояние перед новой попыткой.",
  invalid:
    "Не удалось принять изменения. Проверьте текст, кнопки, заготовки и коды источников.",
  not_found:
    "Объект не найден или недоступен этому аккаунту. Проверьте ID и права.",
  unavailable:
    "Сервис коммуникаций недоступен. Результат операции не подтверждён. Повторите ту же попытку или загрузите актуальное состояние.",
  not_implemented:
    "Эта операция ещё не поддерживается сервисом Telegram. Изменения не подтверждены.",
};
export const lifecycleLabels = {
  draft: "Черновик",
  published: "Опубликована",
  paused: "На паузе",
  archived: "В архиве",
};
export function newPart(): Part {
  return {
    partId: crypto.randomUUID(),
    content: { type: "text", text: "", entities: [], buttons: [] },
  };
}
export function newFunnel(): Funnel {
  return {
    funnelId: crypto.randomUUID(),
    revision: 0,
    publishedRevision: null,
    lifecycle: "draft",
    name: "",
    isDefault: false,
    entryResponse: { stepId: crypto.randomUUID(), parts: [newPart()] },
    steps: [],
    sources: [],
  };
}
