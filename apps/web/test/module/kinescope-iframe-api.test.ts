import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  kinescopeIframeApiUrl,
  loadHedgedIframeApi,
} from "@/features/material-video/api/kinescope-iframe-api.browser";

const timing = { attempts: 3, deadlineMs: 20_000, hedgeAfterMs: 5_000 };

function provider() {
  const requests: {
    readonly url: string;
    readonly resolve: (api: string) => void;
    readonly reject: (error: Error) => void;
  }[] = [];
  return {
    requests,
    loading: {
      current: () => undefined,
      request: (url: string) =>
        new Promise<string>((resolve, reject) => {
          requests.push({ reject, resolve, url });
        }),
    },
  };
}

describe("Kinescope iframe API loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an API the page already has without a request", async () => {
    const request = vi.fn();
    await expect(
      loadHedgedIframeApi({ current: () => "api", request }, timing),
    ).resolves.toBe("api");
    expect(request).not.toHaveBeenCalled();
  });

  it("sends a second request when the first one stalls and keeps the first that answers", async () => {
    const { loading, requests } = provider();
    const loaded = loadHedgedIframeApi(loading, timing);
    expect(requests.map((request) => request.url)).toEqual([
      kinescopeIframeApiUrl,
    ]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.map((request) => request.url)).toEqual([
      kinescopeIframeApiUrl,
      `${kinescopeIframeApiUrl}?attempt=2`,
    ]);
    requests[1]?.resolve("second");
    await expect(loaded).resolves.toBe("second");
    requests[0]?.resolve("first");
    await vi.advanceTimersByTimeAsync(timing.deadlineMs);
    expect(requests).toHaveLength(2);
  });

  it("retries a failed request at once", async () => {
    const { loading, requests } = provider();
    const loaded = loadHedgedIframeApi(loading, timing);
    requests[0]?.reject(new Error("network"));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.map((request) => request.url)).toEqual([
      kinescopeIframeApiUrl,
      `${kinescopeIframeApiUrl}?attempt=2`,
    ]);
    requests[1]?.resolve("api");
    await expect(loaded).resolves.toBe("api");
  });

  it("fails once every attempt has failed", async () => {
    const { loading, requests } = provider();
    const loaded = loadHedgedIframeApi(loading, timing);
    const outcome = loaded.catch((error: unknown) => error);
    for (let attempt = 0; attempt < timing.attempts; attempt += 1) {
      requests[attempt]?.reject(new Error("network"));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(requests).toHaveLength(timing.attempts);
    expect(await outcome).toBeInstanceOf(Error);
  });

  it("fails at the deadline while requests still stall", async () => {
    const { loading, requests } = provider();
    const outcome = loadHedgedIframeApi(loading, timing).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(timing.deadlineMs - 1);
    expect(requests).toHaveLength(timing.attempts);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(Error);
    requests[0]?.resolve("late");
  });
});
