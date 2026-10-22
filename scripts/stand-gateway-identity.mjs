// @ts-check
// How the stand authoring gateway identifies itself (#1672), so a client can tell it from any other
// process that answers HTTP on the gateway port. Kept apart from the gateway process itself.
import process from "node:process";
import { z } from "zod";

/** The gateway answers here about itself. */
export const gatewayIdentityPath = "/__local-api/gateway";
export const gatewayService = "inside-authoring-stand-gateway";
const gatewayProbeTimeoutMs = 2_000;

/**
 * The identity a running gateway reports; `protocol` changes when a client must not reuse it.
 *
 * @param {{ owner: string; api: string; root: string }} options
 */
export function gatewayIdentity({ owner, api, root }) {
  return {
    service: gatewayService,
    protocol: 1,
    owner,
    api,
    pid: process.pid,
    root,
  };
}

const gatewayIdentitySchema = z
  .object({
    service: z.literal(gatewayService),
    protocol: z.literal(1),
    owner: z.string().min(1),
    api: z.string().min(1),
    pid: z.number().int().positive(),
    root: z.string().min(1),
  })
  .passthrough();

/** @typedef {z.infer<typeof gatewayIdentitySchema>} GatewayIdentity */

/**
 * What answers on the gateway port: nothing, this repository's gateway, or another process.
 * Any HTTP answer is not enough; the gateway must report its identity.
 *
 * @param {string} origin
 * @returns {Promise<
 *   | { kind: "free" }
 *   | { kind: "gateway"; identity: GatewayIdentity }
 *   | { kind: "foreign"; detail: string }
 * >}
 */
export async function probeGateway(origin) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`${origin}${gatewayIdentityPath}`, {
      redirect: "error",
      signal: AbortSignal.timeout(gatewayProbeTimeoutMs),
    });
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : undefined;
    if (cause !== undefined && "code" in cause && cause.code === "ECONNREFUSED")
      return { kind: "free" };
    return { kind: "foreign", detail: `no HTTP answer (${String(error)})` };
  }
  const text = await response.text();
  if (!response.ok)
    return { kind: "foreign", detail: `HTTP ${String(response.status)}` };
  try {
    return {
      kind: "gateway",
      identity: gatewayIdentitySchema.parse(JSON.parse(text)),
    };
  } catch {
    return { kind: "foreign", detail: "an answer without gateway identity" };
  }
}
