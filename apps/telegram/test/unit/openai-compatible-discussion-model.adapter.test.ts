// deterministic-test-allow unit-io: Owned loopback HTTP contract proves the real AI SDK request and response boundary; afterEach closes every socket and server.
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAICompatibleDiscussionModelAdapter } from "../../src/adapters/models/openai-compatible-discussion-model.adapter.js";
import type { GroupInput } from "../../src/modules/community-discussions/discussion-model.js";

let server: Server | undefined;
afterEach(async () => {
  const owned = server;
  server = undefined;
  if (owned) {
    owned.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      owned.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
const input: GroupInput = {
  messages: [
    {
      messageId: "10",
      threadId: "7",
      replyToMessageId: null,
      role: "участник 1",
      sentAt: "2026-10-07T09:00:00Z",
      kind: "text",
      text: "Как выбрать инструмент?",
      discussionId: null,
    },
  ],
  discussions: [
    {
      discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      question: "Как выбрать инструмент?",
      answers: "",
      conclusion: "",
      sources: [
        {
          messageId: "9",
          threadId: "7",
          replyToMessageId: null,
          sentAt: "2026-10-06T09:00:00Z",
        },
      ],
    },
  ],
};
async function serve(responseBody: unknown, status = 200) {
  const received: {
    url: string | undefined;
    authorization: string | undefined;
    body: unknown;
  }[] = [];
  server = createServer((request, response) => {
    void (async () => {
      const parts: Buffer[] = [];
      for await (const chunk of request) {
        const value: unknown = chunk;
        if (!(value instanceof Uint8Array))
          throw new Error("Unexpected HTTP chunk");
        parts.push(Buffer.from(value));
      }
      const body: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
      received.push({
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      response.writeHead(status, {
        "content-type": "application/json",
        ...(status === 307 ? { location: "/stolen" } : {}),
      });
      response.end(JSON.stringify(responseBody));
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing loopback listener");
  const adapter = new OpenAICompatibleDiscussionModelAdapter({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "synthetic-model-key",
    model: "synthetic-group-model",
  });
  return { adapter, received };
}
function completion(content: unknown) {
  return {
    id: "synthetic-completion",
    created: 1791363600,
    model: "synthetic-group-model",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(content) },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  };
}
describe("OpenAI compatible grouping HTTP contract", () => {
  it("sends anonymous structured grouping through the AI SDK and returns output plus usage", async () => {
    const { adapter, received } = await serve(
      completion({
        discussions: [
          {
            discussionId: null,
            messageIds: ["10"],
            question: "Как выбрать инструмент?",
            answers: "",
            conclusion: "",
            answered: false,
            hasNewInformation: true,
          },
        ],
      }),
    );
    expect(await adapter.group(input, AbortSignal.timeout(3000))).toEqual({
      discussions: [
        {
          discussionId: null,
          messageIds: ["10"],
          question: "Как выбрать инструмент?",
          answers: "",
          conclusion: "",
          answered: false,
          hasNewInformation: true,
        },
      ],
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    expect(received).toHaveLength(1);
    const request = z
      .object({
        model: z.string(),
        messages: z.array(z.object({ role: z.string(), content: z.string() })),
        response_format: z.looseObject({ type: z.string() }),
      })
      .parse(received[0]?.body);
    expect(received[0]).toMatchObject({
      url: "/v1/chat/completions",
      authorization: "Bearer synthetic-model-key",
    });
    expect(request.model).toBe("synthetic-group-model");
    expect(request.response_format.type).toBe("json_schema");
    expect(request.response_format).toMatchObject({
      json_schema: {
        schema: {
          properties: {
            discussions: {
              items: {
                properties: { messageIds: { items: { enum: ["10"] } } },
              },
            },
          },
        },
      },
    });
    const instructions = request.messages
      .map((message) => message.content)
      .join("\n");
    expect(instructions).toContain("Ответ автора:");
    expect(instructions).toContain("Ответы участников:");
    expect(instructions).toContain("hasNewInformation=false");
    expect(instructions).toContain("I do not know");
    expect(instructions).toContain(
      "A message with discussionId already belongs to that saved discussion",
    );
    expect(JSON.parse(requiredUser(request.messages))).toEqual(input);
  });
  it("rejects invalid structured output and makes one attempt on provider failure", async () => {
    const invalid = await serve(
      completion({ discussions: [{ invalid: true }] }),
    );
    await expect(
      invalid.adapter.group(input, AbortSignal.timeout(3000)),
    ).rejects.toThrow();
    expect(invalid.received).toHaveLength(1);
  });
  it("rejects historical source IDs as incoming membership in an update", async () => {
    const { adapter } = await serve(
      completion({
        discussions: [
          {
            discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            messageIds: ["9", "10"],
            question: "Как выбрать инструмент?",
            answers: "Ответ автора: сравните инструменты.",
            conclusion: "Выбор зависит от задачи.",
            answered: true,
            hasNewInformation: true,
          },
        ],
      }),
    );
    await expect(
      adapter.group(input, AbortSignal.timeout(3000)),
    ).rejects.toThrow();
  });
  it("does not retry a billed provider attempt", async () => {
    const failed = await serve(
      { error: { message: "synthetic unavailable" } },
      503,
    );
    await expect(
      failed.adapter.group(input, AbortSignal.timeout(3000)),
    ).rejects.toThrow();
    expect(failed.received).toHaveLength(1);
  });
  it("refuses provider redirects without forwarding credentials", async () => {
    const redirected = await serve({}, 307);
    await expect(
      redirected.adapter.group(input, AbortSignal.timeout(3000)),
    ).rejects.toThrow();
    expect(redirected.received).toHaveLength(1);
  });
  it("honors cancellation before dispatch", async () => {
    const { adapter, received } = await serve(completion({ discussions: [] }));
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(adapter.group(input, cancellation.signal)).rejects.toThrow();
    expect(received).toHaveLength(0);
  });
});
function requiredUser(messages: { role: string; content: string }[]) {
  const message = messages.find((candidate) => candidate.role === "user");
  if (!message) throw new Error("No user message");
  return message.content;
}
