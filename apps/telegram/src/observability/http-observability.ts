export interface TelegramHttpObservation {
  run<Value>(work: () => Promise<Value>): Promise<Value>;
  finish(result: {
    readonly outcome: "completed" | "aborted";
    readonly status?: number;
  }): void;
}

export interface TelegramHttpObservability {
  startHttp(method: string, route: string): TelegramHttpObservation;
}

/** Static route templates only. No request paths, parameters, query or credentials. */
const routes = new Set([
  "/health",
  "/ready",
  "/metrics",
  "/webhooks/telegram",
  "/integrations/platform/v1/telegram-contacts",
  "/integrations/platform/v1/community-entitlements",
  "/integrations/platform/v1/identity-links",
  "/integrations/platform/v1/identity-links/:linkTransactionRef/confirm",
  "/integrations/identity/v1/sign-in",
  "/integrations/identity/v1/sign-in/:requestRef/status",
  "/integrations/identity/v1/sign-in/:requestRef/consume",
  "/integrations/identity/v1/sign-in/:requestRef/account-link",
  "/integrations/platform/v1/communications",
]);
const methods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

export function telegramHttpDimensions(method: string, route: string) {
  return {
    "http.request.method": methods.has(method) ? method : "_OTHER",
    "http.route": routes.has(route) ? route : "_OTHER",
  };
}

export const disabledTelegramHttpObservability: TelegramHttpObservability = {
  startHttp: () => ({ run: (work) => work(), finish: () => undefined }),
};
