import { describe, expect, test, vi } from "vitest";

import { createKinescopeVideoProvider } from "../../src/modules/videos/adapters/kinescope/kinescope-video-provider.js";

const config = {
  apiBaseUrl: "https://api.kinescope.io",
  apiToken: "provider-secret-token",
  uploaderBaseUrl: "https://uploader.kinescope.io",
} as const;

describe("Kinescope VideoProvider adapter", () => {
  test("initializes a resumable upload with the server credential and provider project", async () => {
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
