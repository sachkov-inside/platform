import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { problemDetails, problemType } from "./problem-details.js";

@Catch(HttpException)
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const fields = isRecord(response) ? response : {};
    // The type always names the code, whatever the thrower wrote, so every response keeps one form.
    const problem = isProblemDetails(fields, status)
      ? { ...fields, type: problemType(fields.code) }
      : problemDetails(status, typeof fields.code === "string" ? fields.code : "http_error", titleFor(status));

    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(status)
      .header("Cache-Control", "private, no-store")
      .type("application/problem+json")
      .send(problem);
  }
}

function isProblemDetails(
  fields: Readonly<Record<string, unknown>>,
  status: number,
): fields is Readonly<Record<string, unknown>> & { readonly code: string } {
  return (
    typeof fields.type === "string" &&
    typeof fields.title === "string" &&
    fields.status === status &&
    typeof fields.code === "string"
  );
}

function titleFor(status: number): string {
  if (status === 400) return "Invalid request";
  if (status === 401) return "Authentication required";
  if (status === 403) return "Request forbidden";
  if (status === 404) return "Resource not found";
  if (status === 409) return "Request conflict";
  if (status === 422) return "Request validation failed";
  if (status === 503) return "Service unavailable";
  return "Request failed";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
