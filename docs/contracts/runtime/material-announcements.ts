import { z } from "zod";

export const materialAnnouncementSchema: z.ZodObject<{
  announcementRef: z.ZodUUID;
  materialId: z.ZodUUID;
  title: z.ZodString;
  summary: z.ZodString;
  url: z.ZodURL;
  occurredAt: z.ZodISODateTime;
  notAfter: z.ZodISODateTime;
}, z.core.$strict> = z.strictObject({
  announcementRef: z.uuid(), materialId: z.uuid(),
  title: z.string().min(1).max(160), summary: z.string().min(1).max(500),
  url: z.url({ protocol: /^https?$/ }),
  occurredAt: z.iso.datetime({ offset: true }), notAfter: z.iso.datetime({ offset: true }),
});
export type MaterialAnnouncement = z.infer<typeof materialAnnouncementSchema>;
export const materialAnnouncementsRequestSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.material-announcements.v1">;
  after: z.ZodOptional<z.ZodUUID>;
  announcementRef: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.material-announcements.v1"),
  after: z.uuid().optional(), announcementRef: z.uuid().optional(),
});
export const materialAnnouncementsResponseSchema: z.ZodObject<{
  items: z.ZodArray<typeof materialAnnouncementSchema>;
  nextCursor: z.ZodNullable<z.ZodUUID>;
}, z.core.$strict> = z.strictObject({
  items: z.array(materialAnnouncementSchema).max(50), nextCursor: z.uuid().nullable(),
});
