// @ts-check
import { randomUUID } from "node:crypto";

/**
 * The caller owns the API process and disposable database; a name is not proof of ownership.
 * @param {{api: string; databaseName: string; ownerToken: string}} input
 */
export function isolatedScenarioApi({ api, databaseName, ownerToken }) {
  const address = new URL(api);
  if (
    address.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ||
    address.username ||
    address.password ||
    address.pathname !== "/" ||
    address.search ||
    address.hash
  )
    throw new Error("Scenario requires its owned loopback API");
  if (!/^inside_(?:light_[a-f0-9]{10}|test_[a-f0-9]{32})$/u.test(databaseName))
    throw new Error("Scenario requires an isolated instance database");

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @param {string} [bearer]
   * @param {string} [idempotencyKey]
   */
  return async function request(
    method,
    path,
    body,
    bearer = ownerToken,
    idempotencyKey = randomUUID(),
  ) {
    const response = await fetch(new URL(path, address), {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        "idempotency-key": idempotencyKey,
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const value = /** @type {unknown} */ (await response.json());
    if (!response.ok)
      throw new Error(
        `Scenario ${method} ${path}: HTTP ${String(response.status)} ${JSON.stringify(value)}`,
      );
    return value;
  };
}
