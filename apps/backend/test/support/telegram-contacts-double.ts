import { createServer, type Server } from "node:http";

import { z } from "zod";

/** How the Telegram double answers: a v2 release, a release before v2 (404), or no answer (503). */
export type TelegramDoubleMode = "v2" | "v1_only" | "down";

/** One stored Telegram profile of a current link, keyed by its pair. */
export interface TelegramDoubleProfile {
  readonly accountRef: string;
  readonly telegramIdentityRef: string;
  readonly displayName: string | null;
  readonly username: string | null;
  readonly marketing: "enabled" | "stopped" | "unknown";
}

const pairsSchema = z.object({
  contacts: z.array(
    z.object({ accountRef: z.string(), telegramIdentityRef: z.string() }),
  ),
});
const searchSchema = z.object({ query: z.string(), limit: z.number() });

/**
 * The Telegram application's contact operations (`inside.telegram-contact.v1` and `v2`) over a
 * loopback HTTP server: the read answers `available` for a known pair and `not_found` otherwise,
 * search matches a case-insensitive substring of the name or username. Each test owns its double.
 */
export async function startTelegramContactsDouble(secret: string): Promise<{
  readonly linkingEndpoint: string;
  readonly profiles: Map<string, TelegramDoubleProfile>;
  mode: TelegramDoubleMode;
  readonly requests: string[];
  close(): Promise<void>;
}> {
  const profiles = new Map<string, TelegramDoubleProfile>();
  const requests: string[] = [];
  const state = { mode: "v2" as TelegramDoubleMode };
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const path = request.url ?? "";
      requests.push(path);
      if (request.headers.authorization !== `Bearer ${secret}`)
        return void response.writeHead(401).end();
      if (state.mode === "down") return void response.writeHead(503).end();
      const v2 = path.startsWith("/integrations/platform/v2/");
      if (v2 && state.mode === "v1_only")
        return void response.writeHead(404).end();
      response.setHeader("content-type", "application/json");
      const payload: unknown = JSON.parse(body);
      if (
        path === "/integrations/platform/v1/telegram-contacts" ||
        path === "/integrations/platform/v2/telegram-contacts/read"
      ) {
        const { contacts } = pairsSchema.parse(payload);
        return void response.end(
          JSON.stringify({
            contractVersion: v2
              ? "inside.telegram-contact.v2"
              : "inside.telegram-contact.v1",
            contacts: contacts.map((pair) => {
              const profile = profiles.get(pair.telegramIdentityRef);
              const known = profile?.accountRef === pair.accountRef;
              return {
                accountRef: pair.accountRef,
                telegramIdentityRef: pair.telegramIdentityRef,
                status: known ? "available" : "not_found",
                displayName: known ? profile.displayName : null,
                username: known ? profile.username : null,
                ...(v2
                  ? { marketing: known ? profile.marketing : "unknown" }
                  : {}),
              };
            }),
          }),
        );
      }
      if (path === "/integrations/platform/v2/telegram-contacts/search") {
        const { query, limit } = searchSchema.parse(payload);
        const text = query.toLowerCase();
        const found = [...profiles.values()].filter(
          (profile) =>
            profile.displayName?.toLowerCase().includes(text) === true ||
            profile.username?.toLowerCase().includes(text) === true,
        );
        return void response.end(
          JSON.stringify({
            contractVersion: "inside.telegram-contact.v2",
            matches: found.slice(0, limit).map((profile) => ({
              accountRef: profile.accountRef,
              telegramIdentityRef: profile.telegramIdentityRef,
              displayName: profile.displayName,
              username: profile.username,
            })),
            truncated: found.length > limit,
          }),
        );
      }
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Telegram double has no TCP port");
  return {
    linkingEndpoint: `http://127.0.0.1:${String(address.port)}/integrations/platform/v1/identity-links`,
    profiles,
    get mode() {
      return state.mode;
    },
    set mode(mode: TelegramDoubleMode) {
      state.mode = mode;
    },
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      ),
  };
}
