import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BackendModule from "@/shared/api/backend/index.server";

import {
  AvatarMutationError,
  mutateProfileAvatar,
} from "@/_pages/account/api/profile-avatar-mutation.browser";
import type { PrivateMemberProfile } from "@/entities/member-profile";
import {
  MAX_PROFILE_AVATAR_FILE_BYTES,
  MAX_PROFILE_AVATAR_MUTATION_BYTES,
} from "@/shared/api/mutation-limits";

const fakes = vi.hoisted(() => {
  class SessionUnavailableError extends Error {}
  return {
    getAccessToken: vi.fn(),
    requestMutation: vi.fn(),
    SessionUnavailableError,
  };
});

vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.getAccessToken,
  LogtoSessionUnavailableError: fakes.SessionUnavailableError,
}));

vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

vi.mock("@/shared/auth/same-origin-mutation.server", () => ({
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
}));

vi.mock("@/shared/auth/index.server", async () => {
  const handler = await import(
    "@/shared/auth/authenticated-mutation-handler.server"
  );
  return { handleAuthenticatedMutation: handler.handleAuthenticatedMutation };
});

vi.mock("@/shared/api/backend/index.server", async (importOriginal) => {
  const original = await importOriginal<typeof BackendModule>();
  return {
    ...original,
    requestProfileAvatarMutation: fakes.requestMutation,
  };
});

import { proxyProfileAvatarMutation } from "@/_pages/account/api/profile-avatar-bff.server";

const profile = {
  avatar: null,
  bio: "Строю платформу.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл",
  publicProfileId: "d3acb421-85e2-4c79-9dfa-4b2c925e56e8",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 3,
} as const satisfies PrivateMemberProfile;

describe("Profile Avatar browser mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeXMLHttpRequest.latest = undefined;
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  });

  it("maps Problem Details from the capability route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { code: "conflict", currentVersion: 4, status: 409 },
          { status: 409 },
        ),
      ),
    );

    const promise = mutateProfileAvatar(
      { kind: "remove", profile },
      vi.fn(),
    );
    await expect(promise).rejects.toBeInstanceOf(AvatarMutationError);
    await expect(promise).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects a malformed success payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ profile: { version: 4 } })),
    );

    await expect(
      mutateProfileAvatar({ kind: "remove", profile }, vi.fn()),
    ).rejects.toThrow("Profile response does not match the API contract");
  });

  it("reports XHR upload progress and validates a successful response", async () => {
    const onProgress = vi.fn();
    const promise = startUpload(onProgress);
    const request = await currentUploadRequest();

    request.upload.emit("progress", {
      lengthComputable: true,
      loaded: 4,
      total: 10,
    });
    request.upload.emit("load");
    request.respond(200, { profile });

    await expect(promise).resolves.toEqual(profile);
    expect(onProgress.mock.calls).toEqual([[0.4], [1]]);
    expect(request.method).toBe("PUT");
    expect(request.url).toBe("/account/avatar");
    expect(request.sentBody).toBeInstanceOf(FormData);
  });

  it("maps an XHR upload Problem response", async () => {
    const promise = startUpload(vi.fn());
    const request = await currentUploadRequest();

    request.respond(422, {
      code: "invalid_avatar",
      reason: "crop_out_of_bounds",
    });

    await expect(promise).rejects.toMatchObject({
      code: "invalid_avatar",
      reason: "crop_out_of_bounds",
    });
  });

  it("rejects malformed XHR success and network failure", async () => {
    const malformedPromise = startUpload(vi.fn());
    const malformedRequest = await currentUploadRequest();
    malformedRequest.respond(200, { profile: { version: 4 } });
    await expect(malformedPromise).rejects.toThrow(
      "Profile response does not match the API contract",
    );

    FakeXMLHttpRequest.latest = undefined;
    const networkPromise = startUpload(vi.fn());
    const networkRequest = await currentUploadRequest();
    networkRequest.emit("error");
    await expect(networkPromise).rejects.toThrow("network");
  });
});

describe("Profile Avatar capability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getAccessToken.mockResolvedValue("access-token");
    fakes.requestMutation.mockResolvedValue(
      Response.json(
        { profile },
        { headers: { "content-type": "application/json" } },
      ),
    );
  });

  it("rejects cross-origin requests before session or backend work", async () => {
    const response = await proxyProfileAvatarMutation(
      removeRequest({ origin: "https://attacker.example.test" }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toMatchObject({
      code: "cross_origin_request",
    });
    expect(fakes.getAccessToken).not.toHaveBeenCalled();
    expect(fakes.requestMutation).not.toHaveBeenCalled();
  });

  it("distinguishes a missing session from an identity outage", async () => {
    fakes.getAccessToken.mockRejectedValueOnce(
      new fakes.SessionUnavailableError(),
    );
    const missingSession = await proxyProfileAvatarMutation(removeRequest());
    expect(missingSession.status).toBe(401);
    await expect(missingSession.json()).resolves.toMatchObject({
      code: "authentication_required",
    });

    fakes.getAccessToken.mockRejectedValueOnce(new Error("identity unavailable"));
    const unavailable = await proxyProfileAvatarMutation(removeRequest());
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "identity_unavailable",
    });
  });

  it("owns an explicit 10 MiB file capability and bounded multipart envelope", async () => {
    expect(MAX_PROFILE_AVATAR_FILE_BYTES).toBe(10 * 1_024 * 1_024);

    const accepted = await proxyProfileAvatarMutation(
      removeRequest({ contentLength: MAX_PROFILE_AVATAR_MUTATION_BYTES }),
    );
    expect(accepted.status).toBe(200);

    const rejected = await proxyProfileAvatarMutation(
      removeRequest({ contentLength: MAX_PROFILE_AVATAR_MUTATION_BYTES + 1 }),
    );
    expect(rejected.status).toBe(413);
    await expect(rejected.json()).resolves.toMatchObject({
      code: "body_too_large",
    });
    expect(fakes.requestMutation).toHaveBeenCalledTimes(1);
  });

  it("enforces the boundary while streaming a body without Content-Length", async () => {
    fakes.requestMutation.mockImplementationOnce(
      async ({ body }: { readonly body: ReadableStream<Uint8Array> }) => {
        await new Response(body).arrayBuffer();
        return Response.json({ profile });
      },
    );
    const body = new Uint8Array(MAX_PROFILE_AVATAR_MUTATION_BYTES + 1);
    const request = new Request("https://inside.example.test/account/avatar", {
      body,
      headers: {
        "content-type": "application/json",
        origin: "https://inside.example.test",
      },
      method: "DELETE",
    });

    const response = await proxyProfileAvatarMutation(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "body_too_large",
    });
  });

  it("maps malformed input and dependency failures to private Problems", async () => {
    const malformed = await proxyProfileAvatarMutation(
      removeRequest({ contentType: "text/plain" }),
    );
    expect(malformed.status).toBe(422);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "invalid_avatar",
    });

    fakes.requestMutation.mockRejectedValueOnce(new Error("backend unavailable"));
    const unavailable = await proxyProfileAvatarMutation(removeRequest());
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("vary")).toBe("cookie");
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "dependency_unavailable",
    });
  });

  it("preserves backend Problem status and selected headers", async () => {
    fakes.requestMutation.mockResolvedValueOnce(
      Response.json(
        { code: "conflict", currentVersion: 4, status: 409 },
        {
          headers: {
            "content-type": "application/problem+json",
            "x-content-type-options": "nosniff",
          },
          status: 409,
        },
      ),
    );

    const response = await proxyProfileAvatarMutation(removeRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toMatchObject({ code: "conflict" });
  });
});

function removeRequest({
  contentLength,
  contentType = "application/json",
  origin = "https://inside.example.test",
}: {
  readonly contentLength?: number;
  readonly contentType?: string;
  readonly origin?: string;
} = {}): Request {
  return new Request("https://inside.example.test/account/avatar", {
    body: JSON.stringify({ expectedVersion: profile.version }),
    headers: {
      ...(contentLength === undefined
        ? {}
        : { "content-length": String(contentLength) }),
      "content-type": contentType,
      origin,
    },
    method: "DELETE",
  });
}

function startUpload(onProgress: (progress: number) => void) {
  return mutateProfileAvatar(
    {
      crop: { centerX: 0.5, centerY: 0.5, zoom: 1 },
      file: new File(["avatar"], "avatar.png", { type: "image/png" }),
      kind: "upload",
      profile,
    },
    onProgress,
  );
}

async function currentUploadRequest(): Promise<FakeXMLHttpRequest> {
  await vi.waitFor(() => {
    expect(FakeXMLHttpRequest.latest).toBeDefined();
  });
  if (FakeXMLHttpRequest.latest === undefined) {
    throw new Error("Expected an avatar XHR request");
  }
  return FakeXMLHttpRequest.latest;
}

type FakeEventListener = (event: Record<string, unknown>) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, FakeEventListener[]>();

  addEventListener(name: string, listener: FakeEventListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

class FakeXMLHttpRequest extends FakeEventTarget {
  static latest: FakeXMLHttpRequest | undefined;

  readonly upload = new FakeEventTarget();
  method: string | undefined;
  response: unknown;
  responseType = "";
  sentBody: Document | XMLHttpRequestBodyInit | null | undefined;
  status = 0;
  url: string | undefined;

  constructor() {
    super();
    FakeXMLHttpRequest.latest = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  respond(status: number, response: unknown): void {
    this.response = response;
    this.status = status;
    this.emit("load");
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.sentBody = body;
  }
}
