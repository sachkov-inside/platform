import { z } from "zod";
const httpsUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
});
const tbankTerminalSchema = z.strictObject({
  environment: z.enum(["demo", "production"]),
  terminalKey: z.string().min(1).max(64), password: z.string().min(1),
  bindingEncryptionKey: z.string().refine(value => Buffer.from(value, "base64").length === 32),
  recurringCardConfirmed: z.literal(true), cardOnlyHostedConfirmed: z.literal(true),
  minimumKopecks: z.int().positive(), maximumKopecks: z.int().positive(),
  returnUrl: httpsUrl, notificationUrl: httpsUrl,
  // Смена карты требует отдельно подтверждённой проверки: CheckType=NO не возвращает RebillId.
  cardBinding: z.strictObject({ confirmed: z.literal(true), checkType: z.enum(["3DS", "3DSHOLD", "HOLD"]) }).optional(),
  receipt: z.strictObject({
    taxation: z.enum(["osn", "usn_income", "usn_income_outcome", "esn", "patent"]),
    tax: z.enum(["none", "vat0", "vat5", "vat7", "vat10", "vat22", "vat105", "vat107", "vat110", "vat122"]),
  }),
});
const withinLimits = (value: { minimumKopecks: number; maximumKopecks: number }) =>
  value.minimumKopecks <= value.maximumKopecks;
/** Настройки терминала: приходят одним значением `TBANK_CONFIG_JSON`. */
export const tbankConfigSchema = tbankTerminalSchema.refine(withinLimits);
/**
 * Полная конфигурация банка. Путь к корневому сертификату принадлежит месту исполнения, а не
 * терминалу, поэтому приходит отдельной переменной `TBANK_CA_FILE` и не является ключом JSON.
 */
export const tbankRuntimeSchema = tbankTerminalSchema
  .extend({ caFile: z.string().min(1).optional() }).refine(withinLimits);
export type TbankConfig = z.infer<typeof tbankRuntimeSchema>;
export function parseTbankConfig(value: string | undefined, caFile?: string): TbankConfig | undefined {
  if (value === undefined) return undefined;
  let terminal: z.infer<typeof tbankConfigSchema>;
  try { terminal = tbankConfigSchema.parse(JSON.parse(value)); }
  catch { throw new Error("Invalid TBANK_CONFIG_JSON; check the terminal capability and receipt configuration"); }
  if (caFile === undefined) return terminal;
  if (caFile.length === 0) throw new Error("Invalid TBANK_CA_FILE; provide the path to the bank certificate root");
  return { ...terminal, caFile };
}
