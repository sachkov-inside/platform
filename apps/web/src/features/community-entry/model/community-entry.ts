import { communityGroupUrlSchema } from "@inside/contracts/community-result";
import { z } from "zod";

/**
 * Какой переход в сообщество Inside показать покупателю. Правило выбирает сервер: интерфейс
 * только называет состояние и не выводит его из прав или связи с Telegram сам.
 */
export const communityEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("link_telegram") }),
  z.strictObject({ kind: z.literal("preparing") }),
  z.strictObject({ kind: z.literal("join"), botUrl: z.url() }),
  z.strictObject({
    kind: z.literal("member"),
    groupUrl: communityGroupUrlSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("restricted") }),
]);
export type CommunityEntry = z.infer<typeof communityEntrySchema>;
