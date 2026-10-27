import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  telegramActivityResultSchema,
  telegramActivityWindowSchema,
  type TelegramActivitySource,
  type TelegramActivityWindow,
} from "@inside/contracts/telegram-activity";
import { observeTelegramHttp } from "../../../../infrastructure/observability/technical-telemetry.js";

const MAX_RESPONSE_BYTES = 524_288;
const unavailable = {
  ok: false,
  error: { code: "source_unavailable" },
} as const;

/** Telegram owns the facts and link projection; the caller receives no provider identifiers. */
export class HttpTelegramActivity implements TelegramActivitySource {
  constructor(
    private readonly linkingEndpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async read(window: TelegramActivityWindow) {
    if (!telegramActivityWindowSchema.safeParse(window).success)
      return { ok: false, error: { code: "invalid_request" } } as const;
    return observeTelegramHttp("activity.read", async (observation) => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const signal = AbortSignal.timeout(5_000);
        const url = new URL("participant-activity", this.linkingEndpoint);
        observation.admit();
        const response = await this.fetcher(url, {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            authorization: `Bearer ${this.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contractVersion: "inside.telegram-activity.v1",
            ...window,
          }),
        });
        observation.response(response.status);
        if (!response.ok || response.body === null) {
          await response.body?.cancel();
          return unavailable;
        }
        reader = response.body.getReader();
        let size = 0;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "";
        for (;;) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) return unavailable;
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        const parsed = telegramActivityResultSchema.safeParse(
          parseActivityResponse(text),
        );
        if (!parsed.success) return unavailable;
        if (
          parsed.data.ok &&
          (Date.parse(parsed.data.value.window.from) !==
            Date.parse(window.from) ||
            Date.parse(parsed.data.value.window.to) !== Date.parse(window.to))
        )
          return unavailable;
        observation.completed();
        return parsed.data;
      } catch (error) {
        return dependencyFailure(
          {
            module: "telegram-membership",
            operation: "readParticipantActivity",
          },
          error,
          unavailable,
        );
      } finally {
        await reader?.cancel().catch(() => {
          // Not a dependency failure: retire an already-consumed or failed response stream.
          return undefined;
        });
        reader?.releaseLock();
      }
    });
  }
}

function parseActivityResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not a dependency failure: malformed foreign JSON is refused without logging its private text.
    return undefined;
  }
}
