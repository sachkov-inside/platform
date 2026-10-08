import { createServer } from "node:http";
import { request, type APIRequestContext } from "@playwright/test";
import { expect, test } from "vitest";

import { backendFixtureInstant } from "../support/backend-fixture-clock";

async function withBackendDate(
  header: string | undefined,
  verify: (client: APIRequestContext, baseUrl: string) => Promise<void>,
  status = 200,
): Promise<void> {
  const server = createServer((_request, response) => {
    response.sendDate = false;
    response.statusCode = status;
    if (header !== undefined) response.setHeader("date", header);
    response.end("ready");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Missing backend clock listener");
    }
    const client = await request.newContext({ timeout: 1_000 });
    try {
      await verify(client, `http://127.0.0.1:${String(address.port)}`);
    } finally {
      await client.dispose();
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
}

test.each([
  ["Wed, 07 Oct 2026 09:00:00 GMT", "2026-10-07T09:00:00.000Z"],
  ["Fri, 09 Oct 2026 09:00:00 GMT", "2026-10-09T09:00:00.000Z"],
])("uses the backend's UTC clock: %s", async (header, instant) => {
  await withBackendDate(header, async (client, baseUrl) => {
    expect(await backendFixtureInstant(client, baseUrl)).toBe(instant);
  });
});

test("does not replace a missing backend clock with the machine's calendar", async () => {
  await withBackendDate(undefined, async (client, baseUrl) => {
    await expect(backendFixtureInstant(client, baseUrl)).rejects.toThrow();
  });
});

test("reads backend UTC when the fixture has incomplete readiness dependencies", async () => {
  await withBackendDate(
    "Fri, 09 Oct 2026 09:00:00 GMT",
    async (client, baseUrl) => {
      expect(await backendFixtureInstant(client, baseUrl)).toBe(
        "2026-10-09T09:00:00.000Z",
      );
    },
    503,
  );
});

test("rejects an unexpected clock endpoint response", async () => {
  await withBackendDate(
    "Fri, 09 Oct 2026 09:00:00 GMT",
    async (client, baseUrl) => {
      await expect(backendFixtureInstant(client, baseUrl)).rejects.toThrow(
        "Backend clock request failed: 404",
      );
    },
    404,
  );
});
