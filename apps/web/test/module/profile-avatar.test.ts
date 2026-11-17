import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
import { routeBrowserMutations } from "../support/mutation-operation-route";
import { useProductionRuntimeImage } from "../support/web-runtime";
import { DELETE, PUT } from "../../app/account/avatar/route";
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
let avatarWire: ReturnType<typeof routeBrowserMutations>;

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
  let cleanupImage: () => void;
  let submittedAvatar: FormData | undefined;
  beforeEach(async () => {
    backendFetch.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
    cleanupImage = useProductionRuntimeImage();
    session = await realBffSession("access-token");
    FakeXMLHttpRequest.latest = undefined;
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    submittedAvatar = undefined;
    backendFetch.mockImplementation(async (request) => {
      if (request.method === "PUT") submittedAvatar = await request.formData();
      else await request.arrayBuffer();
      return Response.json({ profile });
    });
    avatarWire = routeBrowserMutations(
      { "/account/avatar": { DELETE, PUT } },
      "https://inside.example.test",
      { run: (handler) => session(handler), externalFetch: backendFetch },
    );
  });
  afterEach(async () => {
    cleanupImage();
    vi.unstubAllGlobals();
    for (const [request] of backendFetch.mock.calls) {
      expect(request.url).toBe(
        "https://platform-api.example.test/account/profile/avatar",
      );
      expect(request.headers.get("authorization")).toBe("Bearer access-token");
      expect(["DELETE", "PUT"]).toContain(request.method);
      if (!request.bodyUsed) await request.body?.cancel();
    }
    for (const request of avatarWire.requests) {
      expect(request.url).toBe("https://inside.example.test/account/avatar");
      expect(["DELETE", "PUT"]).toContain(request.method);
    }
  });

  it("maps Problem Details from the capability route", async () => {
    backendFetch.mockResolvedValueOnce(
      Response.json(
        { code: "conflict", currentVersion: 4, status: 409 },
        { status: 409 },
      ),
    );
    const promise = mutateProfileAvatar({ kind: "remove", profile }, vi.fn());
    await expect(promise).rejects.toBeInstanceOf(AvatarMutationError);
    await expect(promise).rejects.toMatchObject({ code: "conflict" });
    expect(backendFetch).toHaveBeenCalledOnce();
    expect(backendFetch.mock.calls[0]?.[0].method).toBe("DELETE");
    expect(avatarWire.statuses).toEqual([409]);
    expect(await avatarWire.requests[0]?.json()).toEqual({
      expectedVersion: 3,
    });
  });

  it("rejects a malformed success payload forwarded from the external backend", async () => {
    backendFetch.mockResolvedValueOnce(
      Response.json({ profile: { version: 4 } }),
    );
    await expect(
      mutateProfileAvatar({ kind: "remove", profile }, vi.fn()),
    ).rejects.toThrow("Profile response does not match the API contract");
    expect(backendFetch).toHaveBeenCalledOnce();
    expect(avatarWire.statuses).toEqual([200]);
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
    await request.deliverRealResponse();
    await expect(promise).resolves.toEqual({
      avatar: null,
      bio: "Строю платформу.",
      createdAt: "2026-08-30T10:00:00.000Z",
      displayName: "Кирилл",
      status: "active",
      updatedAt: "2026-08-30T10:00:00.000Z",
      version: 3,
    });
    expect(onProgress.mock.calls).toEqual([[0.4], [1]]);
    expect(request.method).toBe("PUT");
    expect(request.url).toBe("/account/avatar");
    expect(request.sentBody).toBeInstanceOf(FormData);
    expect(backendFetch).toHaveBeenCalledOnce();
    expect(backendFetch.mock.calls[0]?.[0].method).toBe("PUT");
    expect(backendFetch.mock.calls[0]?.[0].headers.get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/u,
    );
    expect(avatarWire.statuses).toEqual([200]);
    const sent = request.sentBody;
    if (!(sent instanceof FormData))
      throw new Error("Expected an avatar multipart request");
    expect(sent.get("expectedVersion")).toBe("3");
    expect(sent.get("crop")).toBe('{"centerX":0.5,"centerY":0.5,"zoom":1}');
    expect(sent.get("declaredSize")).toBe("6");
    expect(submittedAvatar?.get("expectedVersion")).toBe("3");
    expect(submittedAvatar?.get("crop")).toBe(
      '{"centerX":0.5,"centerY":0.5,"zoom":1}',
    );
    expect(submittedAvatar?.get("declaredSize")).toBe("6");
    const forwardedFile = submittedAvatar?.get("file");
    expect(forwardedFile).toBeInstanceOf(File);
    if (!(forwardedFile instanceof File))
      throw new Error("Backend did not receive an avatar file");
    expect(forwardedFile.name).toBe("avatar.png");
    expect(forwardedFile.type).toBe("image/png");
    expect(await forwardedFile.text()).toBe("avatar");
  });

  it("maps an XHR upload Problem response", async () => {
    backendFetch.mockResolvedValueOnce(
      Response.json(
        { code: "invalid_avatar", reason: "crop_out_of_bounds" },
        { status: 422 },
      ),
    );
    const promise = startUpload(vi.fn());
    const request = await currentUploadRequest();
    await request.deliverRealResponse();
    await expect(promise).rejects.toMatchObject({
      code: "invalid_avatar",
      reason: "crop_out_of_bounds",
    });
    expect(backendFetch).toHaveBeenCalledOnce();
    expect(avatarWire.statuses).toEqual([422]);
  });

  it("rejects malformed XHR success and named synthetic interrupted delivery", async () => {
    backendFetch.mockResolvedValueOnce(
      Response.json({ profile: { version: 4 } }),
    );
    const malformedPromise = startUpload(vi.fn());
    const malformedRequest = await currentUploadRequest();
    await malformedRequest.deliverRealResponse();
    await expect(malformedPromise).rejects.toThrow(
      "Profile response does not match the API contract",
    );

    FakeXMLHttpRequest.latest = undefined;
    const networkPromise = startUpload(vi.fn());
    const networkRequest = await currentUploadRequest();
    await networkRequest.interruptDeliveryAfterRealSuccess();
    await expect(networkPromise).rejects.toThrow("network");
    expect(networkRequest.validatedNetworkFault).toBe(true);
    expect(backendFetch).toHaveBeenCalledTimes(2);
    expect(avatarWire.statuses).toEqual([200, 200]);
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
    backendFetch.mockResolvedValue(
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

  private deliveredResponse: Promise<Response> | undefined;
  validatedNetworkFault = false;

  async deliverRealResponse(): Promise<void> {
    if (this.deliveredResponse === undefined)
      throw new Error("XHR has not sent a request");
    const response = await this.deliveredResponse;
    this.response = await response.json();
    this.status = response.status;
    this.emit("load");
  }

  async interruptDeliveryAfterRealSuccess(): Promise<void> {
    if (this.deliveredResponse === undefined)
      throw new Error("XHR has not sent a request");
    const response = await this.deliveredResponse;
    expect(this.method).toBe("PUT");
    expect(this.url).toBe("/account/avatar");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profile: {
        avatar: null,
        bio: "Строю платформу.",
        createdAt: "2026-08-30T10:00:00.000Z",
        displayName: "Кирилл",
        status: "active",
        updatedAt: "2026-08-30T10:00:00.000Z",
        version: 3,
      },
    });
    expect(response.bodyUsed).toBe(true);
    this.validatedNetworkFault = true;
    this.emit("error");
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.sentBody = body;
    if (!(body instanceof FormData))
      throw new Error("Expected an avatar FormData upload");
    // deterministic-test-allow unit-io: #2292, audit2 worker 7e1496b5; the Node XHR event adapter dispatches the real PUT handler in process, without a response producer.
    this.deliveredResponse = avatarWire.fetch("/account/avatar", {
      method: "PUT",
      body,
    });
  }
}
