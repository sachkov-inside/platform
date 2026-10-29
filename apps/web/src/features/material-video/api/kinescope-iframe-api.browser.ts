import type { load } from "@kinescope/player-iframe-api-loader";

export type KinescopeIframePlayer = Awaited<ReturnType<typeof load>>;

export const kinescopeIframeApiUrl =
  "https://player.kinescope.io/latest/iframe.player.js";

export interface IframeApiTiming {
  readonly attempts: number;
  readonly deadlineMs: number;
  readonly hedgeAfterMs: number;
}

/**
 * On the stand Mac a first connection to Kinescope sometimes waited ~16 s on its TLS handshake
 * (#1812, 29.10.2026). A stalled request keeps running; another one starts beside it, and the
 * first API that arrives wins. After the deadline the Reader shows its retry.
 */
export const iframeApiTiming: IframeApiTiming = {
  attempts: 3,
  deadlineMs: 20_000,
  hedgeAfterMs: 5_000,
};

interface IframeApiLoading<Api> {
  /** The API this document already executed, if any. */
  readonly current: () => Api | undefined;
  /** One script request; settles once that copy executed and announced its API. */
  readonly request: () => Promise<Api>;
}

export function loadHedgedIframeApi<Api>(
  loading: IframeApiLoading<Api>,
  timing: IframeApiTiming = iframeApiTiming,
): Promise<Api> {
  const loaded = loading.current();
  if (loaded !== undefined) return Promise.resolve(loaded);
  return new Promise<Api>((resolve, reject) => {
    let settled = false;
    let started = 0;
    let failed = 0;
    let hedge: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedge);
      clearTimeout(deadline);
      outcome();
    };
    const fail = () => {
      settle(() => {
        reject(new Error("Kinescope iframe API is unavailable"));
      });
    };
    const start = () => {
      clearTimeout(hedge);
      if (settled || started === timing.attempts) return;
      started += 1;
      loading.request().then(
        (api) => {
          settle(() => {
            resolve(api);
          });
        },
        () => {
          failed += 1;
          if (failed === timing.attempts) fail();
          else start();
        },
      );
      if (started < timing.attempts)
        hedge = setTimeout(start, timing.hedgeAfterMs);
    };
    const deadline = setTimeout(fail, timing.deadlineMs);
    start();
  });
}

/**
 * The loader waits on a pending script element with the same address instead of requesting it
 * again, so every request after the first in this document gets its own address.
 */
export function iframeApiRequestUrl(sequence: number): string {
  return sequence === 1
    ? kinescopeIframeApiUrl
    : `${kinescopeIframeApiUrl}?attempt=${String(sequence)}`;
}

let requestedScripts = 0;
let shared: Promise<KinescopeIframePlayer> | null = null;

/** One load per document; a failed load is forgotten so the Reader retry requests anew. */
export function loadKinescopeIframePlayer(): Promise<KinescopeIframePlayer> {
  shared ??= import("@kinescope/player-iframe-api-loader")
    .then((iframeApi) =>
      loadHedgedIframeApi({
        current: () => window.Kinescope?.IframePlayer,
        request: () => {
          requestedScripts += 1;
          return iframeApi.load(new URL(iframeApiRequestUrl(requestedScripts)));
        },
      }),
    )
    .catch((error: unknown) => {
      shared = null;
      throw error;
    });
  return shared;
}
