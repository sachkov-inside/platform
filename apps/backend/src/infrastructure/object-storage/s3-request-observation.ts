import type { S3Client } from "@aws-sdk/client-s3";
import { observeS3Operation } from "../observability/technical-telemetry.js";

type ResolvedHandler = Pick<S3Client["config"]["requestHandler"], "handle">;

/** Decorate this already resolved instance, retaining all configuration and lifecycle owners. */
export function observeS3RequestHandler(handler: ResolvedHandler): void {
  const original = handler.handle;
  handler.handle = function (
    this: ResolvedHandler,
    ...args: Parameters<typeof original>
  ) {
    const method = requestMethod(args[0]);
    if (method === undefined) return original.apply(this, args);
    return observeS3Operation(`http.${method}`, async (observation) => {
      const result = await original.apply(this, args);
      const status = responseStatus(result);
      if (status !== undefined) observation.response(status);
      return result;
    });
  };
}

function requestMethod(value: unknown): "GET" | "PUT" | "DELETE" | undefined {
  if (value === null || typeof value !== "object" || !("method" in value))
    return undefined;
  const method = value.method;
  return method === "GET" || method === "PUT" || method === "DELETE"
    ? method
    : undefined;
}

function responseStatus(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || !("response" in value))
    return undefined;
  const response = value.response;
  if (
    response === null ||
    typeof response !== "object" ||
    !("statusCode" in response)
  )
    return undefined;
  return typeof response.statusCode === "number"
    ? response.statusCode
    : undefined;
}
