import { z } from "zod";

export const homePinSchema = z.object({ materialId: z.uuid().nullable(), version: z.number().int().positive() }).strict();
export const homePinResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), pin: homePinSchema }).strict(),
  z.object({ kind: z.enum(["unauthorized", "forbidden", "conflict", "invalid_input", "unavailable"]) }).strict(),
]);
export type HomePinResult = z.infer<typeof homePinResultSchema>;
export type HomePin = z.infer<typeof homePinSchema>;
export interface SetHomePinInput { readonly materialId: string | null; readonly expectedVersion: number }

export interface HomePinControls {
  readonly pin: HomePin | null;
  readonly pending: boolean;
  readonly onChange: (materialId: string | null) => void;
}
