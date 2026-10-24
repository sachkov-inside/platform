import { AsyncLocalStorage } from "node:async_hooks";

import { context, createContextKey } from "@opentelemetry/api";

import { z } from "zod";
import { diagnosticText } from "@inside/contracts/diagnostic-error";

import { technicalLogCorrelation } from "./technical-telemetry.js";

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
const logScopeKey = createContextKey("inside.log.scope");
class LogScope {
  constructor(readonly value: LogContext) {}
}

export function runWithLogContext<Value>(
  scope: LogContext,
  work: () => Value,
): Value {
  // ALS preserves disabled-runtime behaviour; the OTel key carries the same scope through bound Node emitters.
  return contexts.run(scope, () =>
    context.with(
      context.active().setValue(logScopeKey, new LogScope(scope)),
      work,
    ),
  );
}
function currentLogContext(): LogContext | undefined {
  const scope = context.active().getValue(logScopeKey);
  return scope instanceof LogScope ? scope.value : contexts.getStore();
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
    ...currentLogContext(),
    ...technicalLogCorrelation(),
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

export function redactText(text: string, limit = MESSAGE_LIMIT): string {
  return diagnosticText(text, limit);
}

const optional = <Schema extends z.ZodType>(schema: Schema) =>
  schema.optional().catch(undefined);
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
  if (typeof error !== "object" || error === null || !parsed.success)
    return { type: typeof error };
  const fields = parsed.data;
  // Своя ошибка без собственного name называется своим классом.
  const type =
    fields.name === undefined || fields.name === "Error"
      ? // An object without a prototype has no constructor at all.
        ((typeof error.constructor === "function"
          ? error.constructor.name
          : undefined) ??
        fields.name ??
        "object")
      : fields.name;
  const code = fields.code ?? fields.originalCode ?? fields.kind;
  const message =
    fields.message === undefined || inputEchoingType.test(type)
      ? ""
      : redactText(fields.message);
  const stack = (fields.stack ?? "")
    .split("\n")
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
    ...(nested && cause !== undefined
      ? { cause: describeError(cause, depth + 1) }
      : {}),
    ...(errors.length === 0
      ? {}
      : { errors: errors.map((item) => describeError(item, depth + 1)) }),
  };
}
