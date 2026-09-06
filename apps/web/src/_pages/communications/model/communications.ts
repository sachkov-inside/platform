import { z } from "zod";
const count = z.number().int().nonnegative();
const id = z.guid();
const buttonSchema = z.object({
  text: z.string().min(1).max(64),
  url: z.url().startsWith("https://"),
});
const entitySchema = z.object({
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
  offset: count,
  length: count,
  url: z.string().optional(),
  language: z.string().optional(),
});
const textFields = {
  text: z.string(),
  entities: z.array(entitySchema),
  buttons: z.array(buttonSchema).max(20),
};
export const contentSchema = z.discriminatedUnion("type", [
  z.object({ ...textFields, type: z.literal("text") }),
  z.object({
    ...textFields,
    type: z.enum(["photo", "video", "video_note", "voice", "document"]),
    fileId: z.string(),
  }),
]);
export const partSchema = z.object({ partId: id, content: contentSchema });
export const audienceSchema = z.union([
  z.object({ kind: z.literal("all") }),
  z.object({
    kind: z.literal("funnels"),
    funnelIds: z.array(id).min(1).max(100),
  }),
]);
export const broadcastSchema = z.object({
  broadcastId: id,
  revision: count,
  state: z.enum([
    "draft",
    "scheduled",
    "running",
    "paused",
    "cancelled",
    "completed",
  ]),
  parts: z.array(partSchema),
  audience: audienceSchema,
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
  audienceSnapshotId: id.nullable(),
  snapshotSize: count,
});
export const funnelSchema = z.object({
  funnelId: id,
  name: z.string(),
  sources: z.array(
    z.object({ sourceId: id, name: z.string(), code: z.string() }),
  ),
});
export const entrySchema = z.object({
  sourceId: id.nullable(),
  sourceCode: z.string().nullable(),
  funnelId: id.nullable(),
  enteredAt: z.string(),
  outcome: z.string(),
});
export const contactSchema = z.object({
  contactId: id,
  reachable: z.boolean(),
  marketingEnabled: z.boolean(),
  firstSourceId: id.nullable(),
  latestSourceId: id.nullable(),
  entries: z.array(entrySchema),
  nextEntryCursor: z.string().nullable(),
});
export const countsSchema = z.object({
  sent: count,
  suppressed: count,
  failed: count,
  unknown: count,
  partialCancelled: count,
  pending: count,
});
export const statisticsSchema = z.object({
  totalBotContacts: count,
  reachable: count,
  blocked: count,
  marketingOff: count,
  uniqueParticipants: count,
  deliveries: countsSchema,
  trackingHits: count,
  uniqueTokensWithHits: count,
  knownAutomationHits: count,
  analyticsLagSeconds: count,
  contacts: z.array(contactSchema),
  nextCursor: z.string().nullable(),
});
export const deliverySchema = z.object({
  deliveryId: id,
  contactId: id,
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
    }),
  ),
  cancelRequested: z.boolean(),
});
export const backlogSchema = z.union([
  z.object({
    kind: z.literal("ready"),
    pending: count,
    oldestAgeSeconds: count,
  }),
  z.object({ kind: z.literal("unavailable") }),
]);
export const errorSchema = z.object({
  kind: z.literal("error"),
  code: z.string(),
});
const success = <T extends z.ZodRawShape>(shape: T) =>
  z.union([z.object({ kind: z.literal("ready"), ...shape }), errorSchema]);
export const broadcastResultSchema = success({ broadcast: broadcastSchema });
export const broadcastListSchema = success({
  broadcasts: z.array(broadcastSchema),
  nextCursor: z.string().nullable(),
});
export const funnelListSchema = success({
  funnels: z.array(funnelSchema),
  nextCursor: z.string().nullable(),
});
export const statisticsResultSchema = success({
  statistics: statisticsSchema,
  trackingBacklog: backlogSchema,
});
export const deliveryListSchema = success({
  deliveries: z.array(deliverySchema),
  nextCursor: z.string().nullable(),
});
export const entryListSchema = success({
  entries: z.array(entrySchema),
  nextCursor: z.string().nullable(),
});
export const templateResultSchema = success({
  template: z.object({
    templateId: id,
    revision: count,
    content: contentSchema,
  }),
});
export type Broadcast = z.infer<typeof broadcastSchema>;
export type Part = z.infer<typeof partSchema>;
export type Funnel = z.infer<typeof funnelSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Contact = z.infer<typeof contactSchema>;
export type StatisticsResult = z.infer<typeof statisticsResultSchema>;
export type BroadcastResult = z.infer<typeof broadcastResultSchema>;
export const broadcastSaveInputSchema = z.object({
  operationId: id,
  expectedRevision: count,
  payload: z.object({
    broadcastId: id,
    parts: z.array(partSchema).min(1).max(20),
    audience: audienceSchema,
    scheduledAt: z.iso.datetime({ offset: true }).nullable(),
  }),
});
export const broadcastActionInputSchema = z.object({
  operationId: id,
  expectedRevision: count,
  payload: z.object({ broadcastId: id }),
});
export type SaveBroadcastInput = z.infer<typeof broadcastSaveInputSchema>;
export type BroadcastActionInput = z.infer<typeof broadcastActionInputSchema>;
export const stateLabels = {
  draft: "Черновик",
  scheduled: "Запланирована",
  running: "Отправляется",
  paused: "На паузе",
  cancelled: "Отменена",
  completed: "Завершена",
} as const;
export const deliveryLabels = {
  pending: "Ожидает",
  in_flight: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка",
  unknown: "Результат неизвестен",
  suppressed: "Пропущено без восстановления",
  skipped: "Пропущено оператором",
  cancelled: "Отменено",
} as const;
export function errorMessage(code: string): string {
  if (["forbidden", "unauthorized", "authentication_required"].includes(code))
    return "Нужен вход и разрешение на управление коммуникациями.";
  if (code === "link_required")
    return "Сначала свяжите Telegram в настройках аккаунта.";
  if (["revision_conflict", "operation_conflict"].includes(code))
    return "Данные изменились. Загрузите актуальную рассылку перед следующим действием.";
  if (["invalid_input", "malformed", "unsupported_content"].includes(code))
    return "Проверьте содержание, аудиторию и время отправки.";
  if (code === "not_found")
    return "Запись не найдена или недоступна этому автору.";
  return "Сервис временно недоступен. Результат операции мог сохраниться; обновите данные перед новым действием.";
}
