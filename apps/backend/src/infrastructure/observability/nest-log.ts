import type { LoggerService } from "@nestjs/common";

import { describeError, type LogLevel, redactText, writeLog } from "./log.js";

/**
 * Журнал Nest в том же формате, что остальные записи процесса. Отладочные уровни Nest не
 * пишутся; необработанное исключение приходит объектом ошибки и описывается `describeError`.
 */
export class StructuredNestLogger implements LoggerService {
  log(message: unknown, ...parameters: unknown[]): void {
    write("info", message, parameters);
  }

  warn(message: unknown, ...parameters: unknown[]): void {
    write("warn", message, parameters);
  }

  error(message: unknown, ...parameters: unknown[]): void {
    write("error", message, parameters);
  }

  fatal(message: unknown, ...parameters: unknown[]): void {
    write("error", message, parameters);
  }
}

function write(level: LogLevel, message: unknown, parameters: readonly unknown[]): void {
  // Последний параметр Nest — имя источника; стек, пришедший строкой, им не считается.
  const context = parameters.at(-1);
  writeLog(level, "nest", {
    ...(typeof context === "string" && !context.includes("\n") ? { context } : {}),
    ...(message instanceof Error
      ? { error: describeError(message) }
      : { message: redactText(typeof message === "string" ? message : JSON.stringify(message) ?? "") }),
  });
}
