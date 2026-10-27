import { hasText } from "../shared/text.js";
import {
  assertServiceEndpoint,
  assertServiceSecret,
} from "./service-secret.js";

export interface SalesFunnelConfig {
  /** Platform's `inside.sales-funnel-events.v1` ingress; absent keeps events queued. */
  readonly delivery?: { readonly url: string; readonly secret: string };
}

export function loadSalesFunnelConfig(
  env: NodeJS.ProcessEnv,
): SalesFunnelConfig {
  const mode = env["PLATFORM_SALES_FUNNEL_DELIVERY_MODE"] ?? "disabled";
  if (mode !== "disabled" && mode !== "live")
    throw new Error(
      "PLATFORM_SALES_FUNNEL_DELIVERY_MODE must be disabled or live",
    );
  let delivery: SalesFunnelConfig["delivery"];
  if (mode === "live") {
    const url = required(env, "PLATFORM_SALES_FUNNEL_EVENTS_URL");
    assertServiceEndpoint(url, "PLATFORM_SALES_FUNNEL_EVENTS_URL");
    const secret = required(env, "PLATFORM_SALES_FUNNEL_EVENTS_SECRET");
    assertServiceSecret(secret, "PLATFORM_SALES_FUNNEL_EVENTS_SECRET");
    delivery = { url, secret };
  }
  return delivery ? { delivery } : {};
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!hasText(value)) throw new Error(`${name} is required`);
  return value;
}
