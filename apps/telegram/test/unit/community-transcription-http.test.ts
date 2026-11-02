// deterministic-test-allow unit-io: Owned loopback HTTP transcription contract; afterEach closes every socket and server.
import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { OpenAICompatibleDiscussionModelAdapter } from "../../src/adapters/models/openai-compatible-discussion-model.adapter.js";
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
async function serve(status = 200) {
  const requests: {
    path: string | undefined;
    authorization: string | undefined;
    body: string;
  }[] = [];
  server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) {
        const value: unknown = chunk;
        if (!(value instanceof Uint8Array))
          throw new Error("Unexpected HTTP chunk");
        chunks.push(value);
      }
      requests.push({
        path: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("latin1"),
      });
      response.writeHead(status, {
        "content-type": "application/json",
        ...(status === 307 ? { location: "/stolen" } : {}),
      });
      response.end(
        JSON.stringify(
          status === 200
            ? {
                text: "Сначала определите задачу.",
                duration: 23,
                language: "russian",
                segments: [],
              }
            : { error: { message: "synthetic failure" } },
        ),
      );
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing listener");
  const adapter = new OpenAICompatibleDiscussionModelAdapter(
    {
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "group-key",
      model: "group-model",
    },
    {
      baseUrl: `http://127.0.0.1:${address.port}/audio-provider`,
      apiKey: "transcribe-key",
      model: "whisper-1",
    },
  );
  return { adapter, requests };
}
it.each([
  ["audio/ogg", "ogg", Buffer.from("OggSsynthetic-opus")],
  [
    "video/mp4",
    "m4a",
    Buffer.from([
      0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
    ]),
  ],
] as const)(
  "transcribes %s through independent multipart credentials",
  async (mediaType, extension, bytes) => {
    const { adapter, requests } = await serve();
    expect(
      await adapter.transcribe(
        { bytes, mediaType, durationSeconds: 23 },
        AbortSignal.timeout(3000),
      ),
    ).toMatchObject({
      text: "Сначала определите задачу.",
      usage: { inputTokens: null, outputTokens: null, durationSeconds: 23 },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "/audio-provider/audio/transcriptions",
      authorization: "Bearer transcribe-key",
    });
    expect(requests[0]?.body).toContain(`filename="audio.${extension}"`);
    expect(requests[0]?.body).toContain('name="model"\r\n\r\nwhisper-1');
  },
);
it.each([503, 307])("makes one attempt on HTTP %s", async (status) => {
  const { adapter, requests } = await serve(status);
  await expect(
    adapter.transcribe(
      { bytes: Buffer.from("OggSsynthetic"), mediaType: "audio/ogg" },
      AbortSignal.timeout(3000),
    ),
  ).rejects.toThrow();
  expect(requests).toHaveLength(1);
});
it("honors cancellation before transcription dispatch", async () => {
  const { adapter, requests } = await serve();
  await expect(
    adapter.transcribe(
      { bytes: Buffer.from("OggSsynthetic"), mediaType: "audio/ogg" },
      AbortSignal.abort(),
    ),
  ).rejects.toThrow();
  expect(requests).toHaveLength(0);
});
