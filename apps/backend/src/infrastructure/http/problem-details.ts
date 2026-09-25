import { HttpException } from "@nestjs/common";

/** The problem type of one application error code: `urn:inside:problem:<code in kebab-case>`. */
export function problemType(code: string): string {
  return `urn:inside:problem:${code.replaceAll("_", "-")}`;
}

/**
 * The problem details response of one application error. `ProblemDetailsFilter` sends it as is.
 * `details` carries the error's own fields, such as the current version of a conflict, and may
 * name a published problem type that differs from the code.
 */
export function problemException(
  status: number,
  code: string,
  title: string,
  details: Readonly<Record<string, unknown>> & { readonly status?: never; readonly title?: never } = {},
): HttpException {
  return new HttpException({ code, status, title, type: problemType(code), ...details }, status);
}
