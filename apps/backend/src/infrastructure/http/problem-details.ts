import { HttpException } from "@nestjs/common";

/**
 * The problem type of one application error code: `urn:inside:problem:<code>`, the code unchanged.
 * Every backend problem response and the web BFF name their code this way, so a client reads one
 * stable form.
 */
export function problemType<const Code extends string>(
  code: Code,
): `urn:inside:problem:${Code}` {
  return `urn:inside:problem:${code}`;
}

type ProblemFields = Readonly<Record<string, unknown>> & {
  readonly code?: never;
  readonly status?: never;
  readonly title?: never;
  readonly type?: never;
};

type ProblemBody<
  Status extends number,
  Code extends string,
  Title extends string,
  Details,
> = Details & {
  readonly code: Code;
  readonly status: Status;
  readonly title: Title;
  readonly type: `urn:inside:problem:${Code}`;
};

/**
 * The problem details body of one application error. `details` carries the error's own fields,
 * such as the current version of a conflict; the type always follows the code.
 */
export function problemDetails<
  const Status extends number,
  const Code extends string,
  const Title extends string,
  const Details extends ProblemFields = Readonly<Record<never, never>>,
>(
  status: Status,
  code: Code,
  title: Title,
  details?: Details,
): ProblemBody<Status, Code, Title, Details> {
  // The spread keeps every detail and the four fields after it override nothing: `ProblemFields`
  // forbids them in `details`, which TypeScript cannot see through the generic spread.
  const body = { ...details, code, status, title, type: problemType(code) };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return body as ProblemBody<Status, Code, Title, Details>;
}

/** The same body as an exception; `ProblemDetailsFilter` sends it as is. */
export function problemException(
  status: number,
  code: string,
  title: string,
  details: ProblemFields = {},
): HttpException {
  return new HttpException(
    problemDetails(status, code, title, details),
    status,
  );
}
