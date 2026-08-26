import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

export interface IdentityProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly correlationId?: string;
}

@Catch(HttpException)
export class IdentityProblemDetailsFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const fields = isRecord(response) ? response : {};
    const code = typeof fields.code === "string" ? fields.code : "identity_request_failed";
    const correlationId =
      typeof fields.correlationId === "string" ? fields.correlationId : undefined;
    const problem: IdentityProblemDetails = {
      type: `https://inside.sachkov.com/problems/identity/${code.replaceAll("_", "-")}`,
      title: titleFor(status),
      status,
      detail: "Identity request could not be completed.",
      code,
      ...(correlationId === undefined ? {} : { correlationId }),
    };

    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .status(status)
      .type("application/problem+json")
      .send(problem);
  }
}

function titleFor(status: number): string {
  if (status === 400) return "Invalid identity request";
  if (status === 401) return "Identity verification failed";
  if (status === 409) return "Identity request conflict";
  if (status === 503) return "Identity provider unavailable";
  return "Identity service error";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
