import { z } from "zod";

// Словарь прав и то, что каждое право открывает, живут в `@inside/access-capabilities`: витрина
// называет состав доступа до покупки тем же выводом, которым сервер его потом выдаёт.
export {
  accessCapabilitySchema,
  capabilitiesOpenedBy,
  globalAccessCapabilities,
  withheldAccessCapabilities,
  type AccessCapability,
} from "@inside/access-capabilities";
import { accessCapabilitySchema } from "@inside/access-capabilities";
export const capabilitiesSchema = z
  .array(accessCapabilitySchema)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length)
  .overwrite((values) => values.sort());
export const instantSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const reasonSchema = z.string().trim().min(1).max(1000);
export const sourceRefSchema = z.string().min(1).max(256);
export function accessFailure<const Code extends string>(
  code: Code,
): { readonly ok: false; readonly error: { readonly code: Code } } {
  return { ok: false, error: { code } };
}
export type AccessFailure<Code extends string> = ReturnType<
  typeof accessFailure<Code>
>;
export function accessFailureSchema<
  const Codes extends readonly [string, ...string[]],
>(codes: Codes) {
  return z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(codes) }),
  });
}
