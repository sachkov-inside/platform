import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";

import {
  AvatarMutationError,
  mutateProfileAvatar,
} from "@/_pages/account/api/profile-avatar-mutation.browser";
import type { PrivateAccountProfile } from "@/entities/account-profile";
import {
  MAX_PROFILE_AVATAR_FILE_BYTES,
  MAX_PROFILE_AVATAR_MUTATION_BYTES,
} from "@/shared/api/mutation-limits";

const backendFetch = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import { proxyProfileAvatarMutation as realProxyProfileAvatarMutation } from "@/_pages/account/api/profile-avatar-bff.server";

const proxyProfileAvatarMutation = (request: Request) =>
  session(() => realProxyProfileAvatarMutation(request));
afterEach(() => vi.useRealTimers());

const profile = {
  avatar: null,
  bio: "Строю платформу.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 3,
} as const satisfies PrivateAccountProfile;

describe("Profile Avatar browser mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeXMLHttpRequest.latest = undefined;
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  });

  it("maps Problem Details from the capability route", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "conflict", currentVersion: 4, status: 409 },
            { status: 409 },
          ),
        ),
    );

    const promise = mutateProfileAvatar({ kind: "remove", profile }, vi.fn());
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
  beforeEach(async () => {
    backendFetch.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
    session = await realBffSession("access-token");
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      backendFetch(new Request(input, init)),
    );
    backendFetch.mockImplementation(async () =>
      Response.json(
        { profile },
        { headers: { "content-type": "application/json" } },
      ),
    );
  });

  it("rejects cross-origin requests before session or backend work", async () => {
    const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
    const response = await proxyProfileAvatarMutation(
      removeRequest({ origin: "https://attacker.example.test" }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toMatchObject({
      code: "cross_origin_request",
    });
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("distinguishes a missing session from an identity outage", async () => {
    session = await realBffSession(null);
    const missingSession = await proxyProfileAvatarMutation(removeRequest());
    expect(missingSession.status).toBe(401);
    await expect(missingSession.json()).resolves.toMatchObject({
      code: "authentication_required",
    });

    session = await realBffSession({ refreshToken: "provider-refresh" });
    backendFetch.mockRejectedValueOnce(new Error("identity unavailable"));
    const unavailable = await proxyProfileAvatarMutation(removeRequest());
    expect(unavailable.status).toBe(503);
    expect(backendFetch.mock.calls[0]?.[0].url).toBe(
      "https://identity.example.test/oidc/.well-known/openid-configuration",
    );
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
    const sent = backendFetch.mock.calls[0]?.[0];
    expect(sent?.url).toBe(
      "https://platform-api.example.test/account/profile/avatar",
    );
    expect(sent?.method).toBe("DELETE");
    expect(sent?.headers.get("authorization")).toBe("Bearer access-token");
    expect(sent?.headers.get("content-type")).toBe("application/json");
    expect(await sent?.json()).toEqual({ expectedVersion: 3 });

    const rejected = await proxyProfileAvatarMutation(
      removeRequest({ contentLength: MAX_PROFILE_AVATAR_MUTATION_BYTES + 1 }),
    );
    expect(rejected.status).toBe(413);
    await expect(rejected.json()).resolves.toMatchObject({
      code: "body_too_large",
    });
    expect(backendFetch).toHaveBeenCalledTimes(1);
  });

  it("enforces the boundary while streaming a body without Content-Length", async () => {
    backendFetch.mockImplementationOnce(async (request) => {
      await request.arrayBuffer();
      return Response.json({ profile });
    });
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

    backendFetch.mockRejectedValueOnce(new Error("backend unavailable"));
    const unavailable = await proxyProfileAvatarMutation(removeRequest());
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("vary")).toBe("cookie");
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "dependency_unavailable",
    });
  });

  it("preserves backend Problem status and selected headers", async () => {
    backendFetch.mockResolvedValueOnce(
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
