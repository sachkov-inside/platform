import { z } from "zod";

export type MutationMethod = "DELETE" | "PATCH" | "POST" | "PUT";

/** Why the browser received no feature result from the operation's Route Handler. */
export type MutationTransportFailure =
  | { readonly kind: "contract" }
  | { readonly kind: "status"; readonly status: number };

/**
 * The single contract of one same-origin browser mutation (ADR 0038). The browser sends
 * `z.input<Input>` as JSON and receives `z.output<Result>`; the Route Handler parses the body with
 * the same `input` schema and answers with `z.input<Result>`.
 */
export interface MutationOperationDefinition<
  Input extends z.ZodType,
  Result extends z.ZodType,
> {
  readonly input: Input;
  readonly method: MutationMethod;
  readonly path: `/api/${string}`;
  readonly result: Result;
  /** Maps a failed request or a malformed answer to the feature's own outcome. */
  readonly transportFailure: (
    failure: MutationTransportFailure,
  ) => z.output<Result>;
}

export interface MutationOperation<
  Input extends z.ZodType,
  Result extends z.ZodType,
> extends MutationOperationDefinition<Input, Result> {
  /** The browser adapter: one same-origin request to the operation's literal route. */
  readonly send: (input: z.input<Input>) => Promise<z.output<Result>>;
}

/**
 * Declares one named operation. Declare it in a `*.operation.ts` module with literal `path` and
 * `method`; the architecture check holds that route to its Route Handler.
 */
export function defineMutationOperation<
  Input extends z.ZodType,
  Result extends z.ZodType,
>(
  definition: MutationOperationDefinition<Input, Result>,
): MutationOperation<Input, Result> {
  return {
    ...definition,
    send: (input) => sendMutationOperation(definition, input),
  };
}

async function sendMutationOperation<
  Input extends z.ZodType,
  Result extends z.ZodType,
>(
  operation: MutationOperationDefinition<Input, Result>,
  input: z.input<Input>,
): Promise<z.output<Result>> {
  let response: Response;
  try {
    response = await fetch(operation.path, {
      body: JSON.stringify(declaredInput(operation.input, input)),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: operation.method,
    });
  } catch {
    return operation.transportFailure({ kind: "status", status: 503 });
  }
  if (!response.ok) {
    return operation.transportFailure({
      kind: "status",
      status: response.status,
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return operation.transportFailure({ kind: "status", status: 502 });
  }
  const parsed = operation.result.safeParse(body);
  return parsed.success
    ? parsed.data
    : operation.transportFailure({ kind: "contract" });
}

/**
 * Sends only the fields the input schema declares, so an input assembled from wider editor state
 * does not carry that state to the server.
 */
function declaredInput(schema: z.ZodType, input: unknown): unknown {
  if (
    !(schema instanceof z.ZodObject) ||
    typeof input !== "object" ||
    input === null
  ) {
    return input;
  }
  const declared = new Set(Object.keys(schema.shape));
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => declared.has(key)),
  );
}
