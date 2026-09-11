import { z } from "zod";
const httpsUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
});
export const tbankConfigSchema = z.strictObject({
  environment: z.enum(["demo", "production"]),
  terminalKey: z.string().min(1).max(64), password: z.string().min(1),
  bindingEncryptionKey: z.string().refine(value => Buffer.from(value, "base64").length === 32),
  recurringCardConfirmed: z.literal(true), cardOnlyHostedConfirmed: z.literal(true),
  minimumKopecks: z.int().positive(), maximumKopecks: z.int().positive(),
  returnUrl: httpsUrl, notificationUrl: httpsUrl,
  // Смена карты требует отдельно подтверждённой проверки: CheckType=NO не возвращает RebillId.
  cardBinding: z.strictObject({ confirmed: z.literal(true), checkType: z.enum(["3DS", "3DSHOLD", "HOLD"]) }).optional(),
  // Путь к корневому сертификату для соединений с банком; подключается только к ним.
  caFile: z.string().min(1).optional(),
  receipt: z.strictObject({
    taxation: z.enum(["osn", "usn_income", "usn_income_outcome", "esn", "patent"]),
    tax: z.enum(["none", "vat0", "vat5", "vat7", "vat10", "vat22", "vat105", "vat107", "vat110", "vat122"]),
  }),
}).refine(value => value.minimumKopecks <= value.maximumKopecks);
export type TbankConfig = z.infer<typeof tbankConfigSchema>;
export function parseTbankConfig(value: string | undefined, caFile?: string): TbankConfig | undefined {
  if (value === undefined) return undefined;
  try { return tbankConfigSchema.parse({ ...JSON.parse(value), ...(caFile === undefined ? {} : { caFile }) }); }
  catch { throw new Error("Invalid TBANK_CONFIG_JSON; check the terminal capability and receipt configuration"); }
}
