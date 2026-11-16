import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { z } from "zod";
import { commerceScenario } from "../../../../scenarios/commerce.mjs";

const secret = "synthetic-isolated-telegram-provider-secret";
const registrationSchema = z.strictObject({
  contractVersion: z.literal("inside.identity-linking.v1"),
  accountRef: z.string().min(1),
  tokenDigest: z.string().min(1),
  returnCorrelation: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
});
const confirmationSchema = z.strictObject({
  contractVersion: z.literal("inside.identity-linking.v1"),
  accountRef: z.string().min(1),
  returnCorrelation: z.string().min(1),
});
const contactsSchema = z.strictObject({
  contractVersion: z.literal("inside.telegram-contact.v1"),
  contacts: z.array(
    z.strictObject({ accountRef: z.string(), telegramIdentityRef: z.string() }),
  ),
});

/** External Telegram protocol double, owned by a disposable instance. */
export async function startIsolatedTelegramProvider(input: {
  readonly databaseName: string;
}) {
  if (
    !/^inside_(?:light_[a-f0-9]{10}|test_[a-f0-9]{32})$/u.test(
      input.databaseName,
    )
  )
    throw new Error("Telegram scenario requires an isolated database");
  const links = new Map<
    string,
    z.infer<typeof registrationSchema> & {
      readonly linkTransactionRef: string;
      identityRef?: string;
    }
  >();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }
      const payload: unknown = JSON.parse(
        (await buffer(request)).toString("utf8"),
      );
      response.setHeader("content-type", "application/json");
      if (request.url === "/integrations/platform/v1/telegram-contacts") {
        const query = contactsSchema.parse(payload);
        response.end(
          JSON.stringify({
            contractVersion: "inside.telegram-contact.v1",
            contacts: query.contacts.map((pair) => {
              const found = [...links.values()].some(
                (link) =>
                  link.accountRef === pair.accountRef &&
                  link.identityRef === pair.telegramIdentityRef,
              );
              return {
                ...pair,
                status: found ? "available" : "not_found",
                displayName: found
                  ? commerceScenario.telegram.displayName
                  : null,
                username: found ? commerceScenario.telegram.username : null,
              };
            }),
          }),
        );
        return;
      }
      const confirmation =
        /^\/integrations\/platform\/v1\/identity-links\/([^/]+)\/confirm$/u.exec(
          request.url ?? "",
        );
      if (confirmation !== null) {
        const link = links.get(confirmation[1] ?? "");
        const command = confirmationSchema.parse(payload);
        if (link === undefined) {
          response.writeHead(404).end();
          return;
        }
        const agrees =
          link.accountRef === command.accountRef &&
          link.returnCorrelation === command.returnCorrelation;
        response.end(
          JSON.stringify({
            contractVersion: "inside.identity-linking.v1",
            linkTransactionRef: link.linkTransactionRef,
            returnCorrelation: link.returnCorrelation,
            status: !agrees
              ? "conflict"
              : link.identityRef === undefined
                ? "pending"
                : "linked",
            ...(agrees && link.identityRef !== undefined
              ? { telegramIdentityRef: link.identityRef }
              : {}),
          }),
        );
        return;
      }
      if (request.url !== "/integrations/platform/v1/identity-links") {
        response.writeHead(404).end();
        return;
      }
      const registration = registrationSchema.parse(payload);
      const link = { ...registration, linkTransactionRef: randomUUID() };
      links.set(link.linkTransactionRef, link);
      response.end(
        JSON.stringify({
          contractVersion: "inside.identity-linking.v1",
          expiresAt: registration.expiresAt,
          linkTransactionRef: link.linkTransactionRef,
          returnCorrelation: registration.returnCorrelation,
          status: "pending",
        }),
      );
    })().catch(() => {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Isolated Telegram provider has no address");
  }
  return {
    environment: {
      TELEGRAM_BOT_START_URL: "https://t.me/unused_bot",
      TELEGRAM_LINKING_ENDPOINT: `http://127.0.0.1:${String(address.port)}/integrations/platform/v1/identity-links`,
      TELEGRAM_LINKING_SECRET: secret,
    },
    completeLink(deepLink: string) {
      const address = new URL(deepLink);
      const token = address.searchParams.get("start");
      if (
        address.protocol !== "https:" ||
        address.hostname !== "t.me" ||
        token === null
      )
        throw new Error(
          "Only the registered synthetic Telegram link can be completed",
        );
      const digest = createHash("sha256").update(token).digest("base64url");
      const link = [...links.values()].find(
        (candidate) => candidate.tokenDigest === digest,
      );
      if (link === undefined || Date.parse(link.expiresAt) <= Date.now())
        throw new Error("Synthetic Telegram link is absent or expired");
      link.identityRef = commerceScenario.telegram.identityRef;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    },
  };
}
