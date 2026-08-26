import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

@Catch(HttpException)
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const fields = isRecord(response) ? response : {};
    const problem = isProblemDetails(fields, status)
      ? fields
      : {
          type: "about:blank",
          title: titleFor(status),
          status,
          code: typeof fields.code === "string" ? fields.code : "http_error",
        };

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
): boolean {
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
