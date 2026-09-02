import { afterEach, describe, expect, test, vi } from "vitest";

import { createKinescopeVideoProvider } from "../../src/modules/videos/adapters/kinescope/kinescope-video-provider.js";

const config = {
  apiBaseUrl: "https://api.kinescope.io",
  apiToken: "provider-secret-token",
  uploaderBaseUrl: "https://uploader.kinescope.io",
} as const;

afterEach(() => { vi.restoreAllMocks(); });

describe("Kinescope VideoProvider adapter", () => {
  test("initializes a resumable upload with the server credential and provider project", async () => {
    const requestTimeout = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(requestTimeout);
    let observedInit: RequestInit | undefined;
    let observedUrl: string | undefined;
    const request = vi.fn<typeof globalThis.fetch>((input, init) => {
      observedUrl = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
      observedInit = init;
      return Promise.resolve(Response.json({
        data: {
          endpoint: "https://upload.kinescope.io/tus/provider-video",
          id: "provider-video",
        },
      }, { status: 200 }));
    });
    const provider = createKinescopeVideoProvider({ ...config, fetch: request });

    await expect(provider.initUpload({
      access: "membership",
      byteSize: 42,
      filename: "lesson.mp4",
      projectId: "member-project",
      title: "Lesson",
    })).resolves.toEqual({
      id: "provider-video",
      uploadEndpoint: "https://upload.kinescope.io/tus/provider-video",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(observedUrl).toBe("https://uploader.kinescope.io/v2/init");
    expect(observedInit?.method).toBe("POST");
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(observedInit?.signal).toBe(requestTimeout);
    expect(new Headers(observedInit?.headers).get("authorization")).toBe(
      "Bearer provider-secret-token",
    );
    if (typeof observedInit?.body !== "string") throw new Error("request body missing");
    const requestBody = observedInit.body;
    expect(requestBody).toContain('"filename":"lesson.mp4"');
    expect(requestBody).toContain('"parent_id":"member-project"');
    expect(requestBody).toContain('"type":"video"');
  });

  test("returns authoritative project facts so the application can fail a mismatch explicitly", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({
      data: {
        embed_link: "https://kinescope.io/embed/provider-video",
        id: "provider-video",
        project_id: "different-project",
        status: "done",
        title: "Lesson",
      },
    }));
    const provider = createKinescopeVideoProvider({ ...config, fetch: request });

    await expect(provider.find({ id: "provider-video", projectId: "member-project" }))
      .resolves.toMatchObject({ projectId: "different-project" });
  });

  test("deletes one stored provider identity and retains the provider request ID", async () => {
    let observedInit: RequestInit | undefined;
    let observedUrl: string | undefined;
    const request = vi.fn<typeof globalThis.fetch>((input, init) => {
      observedUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      observedInit = init;
      return Promise.resolve(Response.json(
        { data: { success: true } },
        { headers: { "x-request-id": "provider-request-1" } },
      ));
    });
    const provider = createKinescopeVideoProvider({ ...config, fetch: request });

    await expect(provider.delete({ id: "provider-video" })).resolves.toEqual({
      kind: "deleted",
      providerRequestId: "provider-request-1",
    });
    expect(observedUrl).toBe("https://api.kinescope.io/v1/videos/provider-video");
    expect(observedInit?.method).toBe("DELETE");
    expect(new Headers(observedInit?.headers).get("authorization")).toBe(
      "Bearer provider-secret-token",
    );
  });

  test.each([
    [404, "not_found", undefined],
    [429, "retryable_failure", "rate_limited"],
    [500, "retryable_failure", "provider_unavailable"],
    [400, "terminal_failure", "invalid_request"],
    [401, "terminal_failure", "authentication"],
    [403, "terminal_failure", "permission"],
  ] as const)(
    "maps provider DELETE %i to %s",
    async (status, kind, category) => {
      const provider = createKinescopeVideoProvider({
        ...config,
        fetch: vi.fn().mockResolvedValue(new Response(null, {
          headers: { "x-request-id": `provider-request-${String(status)}` },
          status,
        })),
      });

      await expect(provider.delete({ id: "provider-video" })).resolves.toEqual({
        ...(category === undefined ? {} : { category }),
        kind,
        providerRequestId: `provider-request-${String(status)}`,
      });
    },
  );

  test("separates timeout, network and malformed success outcomes", async () => {
    const timeout = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")),
    });
    const network = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn().mockRejectedValue(new TypeError("connection reset")),
    });
    const malformed = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn().mockResolvedValue(Response.json({ data: { success: false } })),
    });

    await expect(timeout.delete({ id: "provider-video" })).resolves.toEqual({
      category: "timeout",
      kind: "retryable_failure",
    });
    await expect(network.delete({ id: "provider-video" })).resolves.toEqual({
      category: "network",
      kind: "retryable_failure",
    });
    await expect(malformed.delete({ id: "provider-video" })).resolves.toEqual({
      category: "invalid_response",
      kind: "terminal_failure",
    });
  });

  test("rejects non-success responses and unsafe embed locators", async () => {
    const unavailable = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    });
    await expect(unavailable.find({ id: "provider-video", projectId: "member-project" }))
      .rejects.toThrow("lookup failed");

    const unsafe = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn().mockResolvedValue(Response.json({
        data: {
          embed_link: "https://attacker.example/embed/provider-video",
          id: "provider-video",
          project_id: "member-project",
          status: "done",
          title: "Lesson",
        },
      })),
    });
    await expect(unsafe.find({ id: "provider-video", projectId: "member-project" }))
      .rejects.toThrow("unsafe embed locator");

    const unsafeUpload = createKinescopeVideoProvider({
      ...config,
      fetch: vi.fn().mockResolvedValue(Response.json({
        data: { endpoint: "https://attacker.example/upload", id: "provider-video" },
      })),
    });
    await expect(unsafeUpload.initUpload({
      access: "free",
      byteSize: 42,
      filename: "lesson.mp4",
      projectId: "public-project",
      title: "Lesson",
    })).rejects.toThrow("unsafe upload endpoint");
  });
});
