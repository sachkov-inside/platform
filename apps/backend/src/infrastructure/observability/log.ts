import { AsyncLocalStorage } from "node:async_hooks";

import { z } from "zod";

import type { BackendProcess } from "../../config/platform-config.js";

/**
 * Единица работы, к которой относится запись журнала: HTTP-запрос API или MCP либо запуск
 * задания воркера. `requestId` у них общий по смыслу — по нему собираются все строки одной работы.
 */
export interface LogContext {
  readonly process: BackendProcess;
  readonly requestId: string;
  readonly method?: string;
  readonly route?: string;
  readonly queue?: string;
}

export type LogLevel = "info" | "warn" | "error";

const contexts = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<Value>(context: LogContext, work: () => Value): Value {
  return contexts.run(context, work);
}

/**
 * Одна строка JSON на событие. Поля собирает вызывающий из известных ему значений; ошибку
 * он передаёт только через `describeError`, потому что её текст может нести чужие данные.
 */
export function writeLog(
  level: LogLevel,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...contexts.getStore(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export interface LoggedError {
  readonly type: string;
  readonly code?: string;
  readonly message?: string;
  readonly stack?: readonly string[];
  readonly cause?: LoggedError;
  readonly errors?: readonly LoggedError[];
}

const MESSAGE_LIMIT = 300;
const STACK_FRAME_LIMIT = 8;
const NESTING_LIMIT = 3;
const AGGREGATE_LIMIT = 3;

// Текст ошибки драйвера и Prisma пересказывает запрос и его аргументы, разбор JSON и схемы —
// сам разбираемый ввод. У таких ошибок остаются только имя и код.
const inputEchoingType = /^(?:Prisma|DriverAdapter|SyntaxError$|ZodError$)/u;

const secretPatterns: readonly (readonly [RegExp, string])[] = [
  // Учётные данные в адресе подключения: postgres://user:password@host.
  [/\b([a-z][a-z\d+.-]*:\/\/)[^\s/?#@]*@/giu, "$1[redacted]@"],
  // Параметры адреса несут подписи, токены и персональные данные.
  [/\b(https?:\/\/[^\s?#]*)[?#]\S*/giu, "$1?[redacted]"],
  [/\beyJ[\w-]*\.[\w-]*\.[\w-]*/gu, "[redacted-jwt]"],
  [/\b(bearer|basic)\s+[\w.~+/=-]+/giu, "$1 [redacted]"],
  [
    /\b(password|passwd|secret|token|api[-_]?key|access[-_]?key|signature|authorization|cookie)(["']?\s*[:=]\s*)["']?[^\s"',;&]+/giu,
    "$1$2[redacted]",
  ],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, "[redacted-email]"],
  // Телефоны, номера карт и прочие длинные номера.
  [/\+?\d(?:[\s()-]?\d){9,}/gu, "[redacted-number]"],
];

export function redactText(text: string): string {
  return secretPatterns
    .reduce((redacted, [pattern, replacement]) => redacted.replace(pattern, replacement), text)
    .slice(0, MESSAGE_LIMIT);
}

const optional = <Schema extends z.ZodType>(schema: Schema) => schema.optional().catch(undefined);
const errorShape = z.object({
  name: optional(z.string()),
  code: optional(z.union([z.string(), z.number()])),
  originalCode: optional(z.string()),
  kind: optional(z.string()),
  message: optional(z.string()),
  stack: optional(z.string()),
  cause: z.unknown().optional(),
  errors: optional(z.array(z.unknown())),
  meta: optional(z.object({ driverAdapterError: z.unknown().optional() })),
});

/**
 * Описание ошибки, которое можно записать в журнал: тип, код, текст без секретов и
 * персональных данных, кадры стека и вложенные причины. Значения полей ошибки вроде
 * `detail` у PostgreSQL не читаются: в них лежат строки, на которых упал запрос.
 */
export function describeError(error: unknown, depth = 0): LoggedError {
  const parsed = errorShape.safeParse(error);
  if (typeof error !== "object" || error === null || !parsed.success) return { type: typeof error };
  const fields = parsed.data;
  // Своя ошибка без собственного name называется своим классом.
  const type = fields.name === undefined || fields.name === "Error"
    ? error.constructor?.name ?? fields.name ?? "object"
    : fields.name;
  const code = fields.code ?? fields.originalCode ?? fields.kind;
  const message = fields.message === undefined || inputEchoingType.test(type)
    ? ""
    : redactText(fields.message);
  const stack = (fields.stack ?? "").split("\n")
    .filter((line) => /^\s+at /u.test(line))
    .slice(0, STACK_FRAME_LIMIT)
    .map((line) => line.trim());
  const cause = fields.cause ?? fields.meta?.driverAdapterError;
  const nested = depth < NESTING_LIMIT;
  const errors = nested ? (fields.errors ?? []).slice(0, AGGREGATE_LIMIT) : [];
  return {
    type,
    ...(code === undefined ? {} : { code: String(code) }),
    ...(message === "" ? {} : { message }),
    ...(stack.length === 0 ? {} : { stack }),
    ...(nested && cause !== undefined ? { cause: describeError(cause, depth + 1) } : {}),
    ...(errors.length === 0 ? {} : { errors: errors.map((item) => describeError(item, depth + 1)) }),
  };
}
