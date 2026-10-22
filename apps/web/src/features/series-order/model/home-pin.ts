import { z } from "zod";

export const homePinSchema = z
  .object({
    seriesId: z.uuid().nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const homePinResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), pin: homePinSchema }).strict(),
  z
    .object({
      kind: z.enum([
        "unauthorized",
        "forbidden",
        "conflict",
        "invalid_input",
        "unavailable",
      ]),
    })
    .strict(),
]);
export type HomePinResult = z.infer<typeof homePinResultSchema>;
export type HomePin = z.infer<typeof homePinSchema>;
/** The JSON body of a Home pin change; `null` clears the pin. */
export const setHomePinInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  seriesId: z.uuid().nullable(),
});
export interface SetHomePinInput {
  readonly seriesId: string | null;
  readonly expectedVersion: number;
}

export interface HomePinControls {
  readonly pin: HomePin | null;
  readonly pending: boolean;
  readonly onChange: (seriesId: string | null) => void;
}
