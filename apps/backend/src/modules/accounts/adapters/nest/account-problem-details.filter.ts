import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { problemDetails, problemType } from "../../../../infrastructure/http/problem-details.js";

@Catch(HttpException)
export class AccountProblemDetailsFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const fields = isRecord(response) ? response : {};
    const code = typeof fields.code === "string" ? fields.code : "account_request_failed";
    const correlationId =
      typeof fields.correlationId === "string" ? fields.correlationId : undefined;
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(status)
      .header("Cache-Control", "private, no-store")
      .type("application/problem+json")
      .send(
        isProblemDetails(fields, status)
          ? { ...fields, type: problemType(code) }
          : problemDetails(status, code, titleFor(status), {
              detail: "Account request could not be completed.",
              ...(correlationId === undefined ? {} : { correlationId }),
            }),
      );
  }
}

function isProblemDetails(
  fields: Readonly<Record<string, unknown>>,
  status: number,
): boolean {
  return (
    typeof fields.type === "string" &&
    typeof fields.title === "string" &&
    fields.status === status &&
    typeof fields.code === "string"
  );
}

function titleFor(status: number): string {
  if (status === 400) return "Invalid account request";
  if (status === 401) return "Account verification failed";
  if (status === 409) return "Account identity conflict";
  if (status === 503) return "Identity provider unavailable";
  return "Account service error";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
