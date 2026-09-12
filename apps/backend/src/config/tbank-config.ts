import { z } from "zod";
const cleanUrl = z.url().refine(value => {
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash;
});
const httpsUrl = cleanUrl.refine(value => new URL(value).protocol === "https:");
/** Origin формы банка: только схема и узел, потому что сравнивается он с `URL.origin` ответа. */
const formOrigin = cleanUrl.refine(value => new URL(value).origin === value);
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
/**
 * Адреса контура оплаты: куда adapter отправляет вызовы и какие origin допускает у формы банка.
 * Боевой контур ведёт в банк, локальный — в двойника на стенде, и выбор принадлежит конфигурации.
 */
const bankEndpointsSchema = z.strictObject({
  apiBaseUrl: cleanUrl.refine(value => !value.endsWith("/")),
  formOrigins: z.array(formOrigin).min(1),
});
const realBankEndpoints = {
  apiBaseUrl: "https://securepay.tinkoff.ru/v2",
  formOrigins: ["https://securepay.tinkoff.ru", "https://pay.tbank.ru"],
} as const;
const withinLimits = (value: { minimumKopecks: number; maximumKopecks: number }) =>
  value.minimumKopecks <= value.maximumKopecks;
/** Настройки терминала: приходят одним значением `TBANK_CONFIG_JSON`. */
export const tbankConfigSchema = tbankTerminalSchema.refine(withinLimits);
/**
 * Полная конфигурация банка. Путь к корневому сертификату принадлежит месту исполнения, а не
 * терминалу, поэтому приходит отдельной переменной `TBANK_CA_FILE` и не является ключом JSON.
 * Окружение `local` — двойник банка на стенде: только оно допускает адреса без HTTPS, потому что
 * у стенда нет ни домена, ни сертификата.
 */
export const tbankRuntimeSchema = tbankTerminalSchema
  .extend({
    environment: z.enum(["demo", "production", "local"]),
    caFile: z.string().min(1).optional(), endpoints: bankEndpointsSchema,
    returnUrl: cleanUrl, notificationUrl: cleanUrl,
  })
  .refine(withinLimits)
  .refine(value => value.environment === "local" || [value.returnUrl, value.notificationUrl,
    value.endpoints.apiBaseUrl, ...value.endpoints.formOrigins].every(url => new URL(url).protocol === "https:"),
  "A bank contour other than the local double accepts HTTPS addresses only");
export type TbankConfig = z.infer<typeof tbankRuntimeSchema>;
export function parseTbankConfig(value: string | undefined, caFile?: string): TbankConfig | undefined {
  if (value === undefined) return undefined;
  let terminal: z.infer<typeof tbankConfigSchema>;
  try { terminal = tbankConfigSchema.parse(JSON.parse(value)); }
  catch { throw new Error("Invalid TBANK_CONFIG_JSON; check the terminal capability and receipt configuration"); }
  if (caFile !== undefined && caFile.length === 0)
    throw new Error("Invalid TBANK_CA_FILE; provide the path to the bank certificate root");
  return tbankRuntimeSchema.parse({ ...terminal, endpoints: realBankEndpoints, ...(caFile === undefined ? {} : { caFile }) });
}

const DEFAULT_LOCAL_BANK_API_BASE_URL = "http://127.0.0.1:8090/v2";
const DEFAULT_LOCAL_BANK_FORM_ORIGIN = "http://127.0.0.1:8090";
const DEFAULT_LOCAL_BANK_NOTIFICATION_URL = "http://127.0.0.1:3001/billing/tbank/notification";
const DEFAULT_LOCAL_BANK_RETURN_URL = "http://127.0.0.1:3000/subscription/return";
/**
 * Терминал двойника банка. Существует только при `TBANK_PROVIDER_MODE=test`, описывает стенд
 * целиком и потому не читает ни `TBANK_CONFIG_JSON`, ни сертификат. Ключ шифрования привязок
 * постоянный: на стенде он закрывает выдуманный `RebillId`, а не карту. Границы суммы широкие,
 * чтобы проходила любая цена локального каталога. Подтверждение привязки включено: без него
 * продление и смену карты на стенде проверить нечем.
 */
export function localTbankConfig(environment: NodeJS.ProcessEnv): TbankConfig {
  return tbankRuntimeSchema.parse({
    environment: "local",
    terminalKey: "INSIDELOCALDOUBLE", password: "inside-local-bank-double-password",
    bindingEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
    recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
    cardBinding: { confirmed: true, checkType: "3DS" },
    minimumKopecks: 100, maximumKopecks: 100_000_000,
    returnUrl: environment.TBANK_TEST_RETURN_URL?.trim() || DEFAULT_LOCAL_BANK_RETURN_URL,
    notificationUrl: environment.TBANK_TEST_NOTIFICATION_URL?.trim() || DEFAULT_LOCAL_BANK_NOTIFICATION_URL,
    receipt: { taxation: "usn_income", tax: "none" },
    endpoints: {
      apiBaseUrl: environment.TBANK_TEST_API_BASE_URL?.trim() || DEFAULT_LOCAL_BANK_API_BASE_URL,
      formOrigins: [environment.TBANK_TEST_PUBLIC_ORIGIN?.trim() || DEFAULT_LOCAL_BANK_FORM_ORIGIN],
    },
  });
}
