import { expect, test, vi } from "vitest";
import { communityDiscussionsRequestSchema } from "@inside/contracts/community-discussions";
import { HttpCommunityDiscussionsProvider } from "../../src/modules/community-discussions/infrastructure/http-community-discussions-provider.js";

const config = {
  endpoint:
    "http://127.0.0.1:9876/integrations/platform/v1/community-discussions",
  secret: "synthetic-discussions-secret",
};
const request = communityDiscussionsRequestSchema.parse({
  contractVersion: "inside.community-discussions.v1",
  requestId: "request-1",
  operation: "discussions.list",
  actor: { accountRef: "synthetic-author" },
  limit: 20,
});
const success = {
  contractVersion: "inside.community-discussions.v1",
  requestId: "request-1",
  operation: "discussions.list",
  status: "ok",
  items: [],
  nextCursor: null,
};

test("a filtered list rejects content already acknowledged by the author", async () => {
  const input = communityDiscussionsRequestSchema.parse({
    ...request,
    unreviewedOnly: true,
  });
  const value = {
    ...success,
    items: [
      {
        discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "reviewed",
        question: "Question",
        answers: "Answer",
        conclusion: "Conclusion",
        createdAt: "2026-11-01T12:00:00Z",
        updatedAt: "2026-11-01T12:00:00Z",
        materialUrls: [],
        revision: 1,
        hasChanges: false,
      },
    ],
  };
  expect(
    await new HttpCommunityDiscussionsProvider(config, () =>
      Promise.resolve(Response.json(value)),
    ).execute(input),
  ).toEqual({ ok: false, error: { code: "provider_invalid_response" } });
});

test.each([undefined, 2])(
  "a version-bound mark rejects acknowledgement of revision %s",
  async (revision) => {
    const input = communityDiscussionsRequestSchema.parse({
      contractVersion: request.contractVersion,
      requestId: request.requestId,
      actor: request.actor,
      operation: "discussions.mark",
      discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "reviewed",
      materialUrls: [],
      expectedRevision: 1,
    });
    const value = {
      contractVersion: request.contractVersion,
      requestId: request.requestId,
      operation: "discussions.mark",
      status: "ok",
      discussion: {
        discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "reviewed",
        question: "Question",
        answers: "Answer",
        conclusion: "Conclusion",
        createdAt: "2026-11-01T12:00:00Z",
        updatedAt: "2026-11-01T12:00:00Z",
        materialUrls: [],
        revision,
      },
    };
    expect(
      await new HttpCommunityDiscussionsProvider(config, () =>
        Promise.resolve(Response.json(value)),
      ).execute(input),
    ).toEqual({ ok: false, error: { code: "provider_invalid_response" } });
  },
);

test("discussion provider preserves the request and validates its matching response", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(success));
  await expect(
    new HttpCommunityDiscussionsProvider(config, fetcher).execute(request),
  ).resolves.toEqual({ ok: true, value: success });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([
    config.endpoint,
    expect.objectContaining({
      body: JSON.stringify(request),
      redirect: "error",
      headers: {
        authorization: `Bearer ${config.secret}`,
        "content-type": "application/json",
      },
    }),
  ]);
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});

test.each([
  [
    401,
    { contractVersion: success.contractVersion, status: "unauthorized" },
    "unauthorized",
  ],
  [
    403,
    { contractVersion: success.contractVersion, status: "forbidden" },
    "forbidden",
  ],
  [
    503,
    {
      contractVersion: success.contractVersion,
      status: "authorization_unavailable",
    },
    "authorization_unavailable",
  ],
  [
    400,
    { contractVersion: success.contractVersion, status: "malformed" },
    "malformed",
  ],
  [
    404,
    { contractVersion: success.contractVersion, status: "not_found" },
    "not_found",
  ],
  [
    409,
    { contractVersion: success.contractVersion, status: "operation_conflict" },
    "operation_conflict",
  ],
  [
    200,
    { contractVersion: success.contractVersion, status: "forbidden" },
    "provider_invalid_response",
  ],
  [503, success, "provider_invalid_response"],
  [200, { ...success, requestId: "unrelated" }, "provider_invalid_response"],
  [
    200,
    { ...success, operation: "discussions.read" },
    "provider_invalid_response",
  ],
  [200, { ...success, unexpected: true }, "provider_invalid_response"],
] as const)(
  "validates status %s and the response identity",
  async (status, body, code) => {
    await expect(
      new HttpCommunityDiscussionsProvider(config, () =>
        Promise.resolve(Response.json(body, { status })),
      ).execute(request),
    ).resolves.toEqual({ ok: false, error: { code } });
  },
);

test("mark replies must identify the requested discussion and preserve the requested status", async () => {
  const input = communityDiscussionsRequestSchema.parse({
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    actor: request.actor,
    operation: "discussions.mark",
    discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "reviewed",
    materialUrls: [],
  });
  const discussion = {
    discussionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "reviewed",
    question: "Question",
    answers: "Answer",
    conclusion: "Conclusion",
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    materialUrls: [],
  };
  const value = {
    ...success,
    operation: "discussions.mark",
    items: undefined,
    nextCursor: undefined,
    discussion,
  };
  await expect(
    new HttpCommunityDiscussionsProvider(config, () =>
      Promise.resolve(Response.json(value)),
    ).execute(input),
  ).resolves.toEqual({
    ok: false,
    error: { code: "provider_invalid_response" },
  });
});

test("an uncertain mark is sent once and explicit retries retain the same request ID", async () => {
  const input = communityDiscussionsRequestSchema.parse({
    contractVersion: request.contractVersion,
    requestId: "mark-1",
    actor: request.actor,
    operation: "discussions.mark",
    discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "reviewed",
    materialUrls: [],
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("lost reply"));
  const provider = new HttpCommunityDiscussionsProvider(config, fetcher);
  await expect(provider.execute(input)).resolves.toEqual({
    ok: false,
    error: { code: "provider_unavailable" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await provider.execute(input);
  expect(fetcher.mock.calls.map((call) => call[1]?.body)).toEqual([
    JSON.stringify(input),
    JSON.stringify(input),
  ]);
});

test("discussion configuration requires its complete dedicated credential pair", async () => {
  const { parsePlatformConfig } =
    await import("../../src/config/platform-config.js");
  expect(
    parsePlatformConfig({ NODE_ENV: "test" }).communityDiscussions,
  ).toBeUndefined();
  expect(() =>
    parsePlatformConfig({
      NODE_ENV: "test",
      TELEGRAM_COMMUNITY_DISCUSSIONS_ENDPOINT: config.endpoint,
    }),
  ).toThrow();
  expect(
    parsePlatformConfig({
      NODE_ENV: "test",
      TELEGRAM_COMMUNITY_DISCUSSIONS_ENDPOINT: config.endpoint,
      TELEGRAM_COMMUNITY_DISCUSSIONS_SECRET: config.secret,
    }).communityDiscussions,
  ).toEqual(config);
  expect(() =>
    parsePlatformConfig({
      NODE_ENV: "test",
      TELEGRAM_COMMUNITY_DISCUSSIONS_ENDPOINT: config.endpoint,
      TELEGRAM_COMMUNITY_DISCUSSIONS_SECRET: config.secret,
      TELEGRAM_LINKING_SECRET: config.secret,
    }),
  ).toThrow();
});

test("provider refuses a list page larger than the caller's bound", async () => {
  const discussion = {
    discussionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "new",
    question: "Question",
    answers: "",
    conclusion: "",
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    materialUrls: [],
  };
  const value = {
    ...success,
    items: [
      discussion,
      { ...discussion, discussionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ],
  };
  await expect(
    new HttpCommunityDiscussionsProvider(config, () =>
      Promise.resolve(Response.json(value)),
    ).execute({ ...request, operation: "discussions.list", limit: 1 }),
  ).resolves.toEqual({
    ok: false,
    error: { code: "provider_invalid_response" },
  });
});

test.each([
  {
    label: "error status",
    status: 200,
    body: { contractVersion: success.contractVersion, status: "forbidden" },
    cause: "response_status",
  },
  {
    label: "success status",
    status: 503,
    body: success,
    cause: "response_status",
  },
  {
    label: "shape",
    status: 200,
    body: { ...success, unexpected: "private-message-body" },
    cause: "response_shape",
  },
  {
    label: "binding",
    status: 200,
    body: { ...success, requestId: "private-message-body" },
    cause: "response_binding",
  },
])(
  "records a safe dependency cause for invalid $label",
  async ({ status, body, cause }) => {
    const lines = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        new HttpCommunityDiscussionsProvider(config, () =>
          Promise.resolve(Response.json(body, { status })),
        ).execute(request),
      ).resolves.toEqual({
        ok: false,
        error: { code: "provider_invalid_response" },
      });
      expect(lines).toHaveBeenCalledOnce();
      const line = String(lines.mock.calls[0]?.[0]);
      expect(JSON.parse(line)).toMatchObject({
        event: "dependency_failure",
        module: "community-discussions",
        operation: "execute",
        outcome: "provider_invalid_response",
        error: { code: cause },
      });
      expect(line).not.toContain("private-message-body");
      expect(line).not.toContain(config.secret);
    } finally {
      lines.mockRestore();
    }
  },
);
