// deterministic-test-allow unit-io: Owned loopback Bot API file contract; afterEach closes every socket and server.
import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { TelegramCommunityFilesAdapter } from "../../src/adapters/telegram/telegram-community-files.adapter.js";
let server: Server | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
});
async function serve(
  mode: "success" | "oversize" | "redirect" | "failure" | "stall" = "success",
  timeoutMs = 3000,
) {
  const requests: string[] = [];
  let arrived!: () => void;
  const downloadArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url?.includes("getFile") === true) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          result: { file_path: "voice/synthetic.oga" },
        }),
      );
    } else if (mode === "stall") {
      arrived();
    } else if (mode === "redirect") {
      response.writeHead(307, { location: "/stolen" });
      response.end();
    } else if (mode === "failure") {
      response.writeHead(503);
      response.end("synthetic-token-leak");
    } else {
      response.writeHead(200);
      response.end(mode === "oversize" ? "OggSoversized" : "OggS");
    }
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing listener");
  return {
    adapter: new TelegramCommunityFilesAdapter(
      "synthetic-token",
      `http://127.0.0.1:${address.port}`,
      { maxBytes: 8, timeoutMs },
    ),
    requests,
    downloadArrived,
  };
}
it("downloads only when called and exposes bytes instead of credential URLs", async () => {
  const { adapter, requests } = await serve();
  expect(requests).toEqual([]);
  expect(await adapter.download("synthetic-file")).toEqual(Buffer.from("OggS"));
  expect(requests).toHaveLength(2);
});
it.each(["oversize", "redirect", "failure"] as const)(
  "rejects %s without leaking the bot token",
  async (mode) => {
    const { adapter, requests } = await serve(mode);
    await expect(adapter.download("synthetic-file")).rejects.toThrow(
      "Community file download failed",
    );
    expect(requests).toHaveLength(2);
  },
);
it("honors cancellation before file lookup", async () => {
  const { adapter, requests } = await serve();
  await expect(
    adapter.download("synthetic-file", AbortSignal.abort()),
  ).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

it("bounds a stalled download with the file deadline", async () => {
  const { adapter } = await serve("stall", 30);
  await expect(adapter.download("synthetic-file")).rejects.toThrow(
    "Community file download failed",
  );
});
it("cancels a download already in flight", async () => {
  const { adapter, downloadArrived } = await serve("stall");
  const cancellation = new AbortController();
  const download = adapter.download("synthetic-file", cancellation.signal);
  const rejected = expect(download).rejects.toThrow(
    "Community file download failed",
  );
  await downloadArrived;
  cancellation.abort();
  await rejected;
});
