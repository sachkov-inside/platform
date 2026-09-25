import { HttpException } from "@nestjs/common";

/**
 * The problem type of one application error code: `urn:inside:problem:<code>`, the code unchanged.
 * Every backend problem response and the web BFF name their code this way, so a client reads one
 * stable form.
 */
export function problemType<const Code extends string>(code: Code): `urn:inside:problem:${Code}` {
  return `urn:inside:problem:${code}`;
}

type ProblemFields = Readonly<Record<string, unknown>> & {
  readonly status?: never;
  readonly title?: never;
  readonly type?: never;
};

/**
 * The problem details body of one application error. `details` carries the error's own fields,
 * such as the current version of a conflict; the type always follows the code.
 */
export function problemDetails(
  status: number,
  code: string,
  title: string,
  details: ProblemFields = {},
): Readonly<Record<string, unknown>> {
  return { ...details, code, status, title, type: problemType(code) };
}

/** The same body as an exception; `ProblemDetailsFilter` sends it as is. */
export function problemException(
  status: number,
  code: string,
  title: string,
  details: ProblemFields = {},
): HttpException {
  return new HttpException(problemDetails(status, code, title, details), status);
}
