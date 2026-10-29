import type { load } from "@kinescope/player-iframe-api-loader";

export type KinescopeIframePlayer = Awaited<ReturnType<typeof load>>;

/** The page preloads this exact address so the first request reuses the response. */
export const kinescopeIframeApiUrl =
  "https://player.kinescope.io/latest/iframe.player.js";

/**
 * A first connection to Kinescope sometimes waits ~16 s on its TLS handshake (#1812), while a
 * fresh request usually answers in ~0.2 s. A stalled request keeps running; another one starts
 * beside it, and the first API that arrives wins. After the deadline the Reader shows its retry.
 */
export const iframeApiTiming = {
  attempts: 3,
  deadlineMs: 20_000,
  hedgeAfterMs: 5_000,
} as const;

interface IframeApiLoading<Api> {
  /** The API this document already executed, if any. */
  readonly current: () => Api | undefined;
  /** One script request; settles once that copy executed and announced its API. */
  readonly request: (url: string) => Promise<Api>;
}

export function loadHedgedIframeApi<Api>(
  loading: IframeApiLoading<Api>,
  timing: {
    readonly attempts: number;
    readonly deadlineMs: number;
    readonly hedgeAfterMs: number;
  } = iframeApiTiming,
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
      // A distinct address is a separate request, not a wait on the stalled one.
      const url =
        started === 1
          ? kinescopeIframeApiUrl
          : `${kinescopeIframeApiUrl}?attempt=${String(started)}`;
      loading.request(url).then(
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

let shared: Promise<KinescopeIframePlayer> | null = null;

/** One load per document; a failed load is forgotten so the Reader retry starts afresh. */
export function loadKinescopeIframePlayer(): Promise<KinescopeIframePlayer> {
  shared ??= import("@kinescope/player-iframe-api-loader")
    .then((iframeApi) =>
      loadHedgedIframeApi({
        current: () => window.Kinescope?.IframePlayer,
        request: (url) => iframeApi.load(new URL(url)),
      }),
    )
    .catch((error: unknown) => {
      shared = null;
      throw error;
    });
  return shared;
}
