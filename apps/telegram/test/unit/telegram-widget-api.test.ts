import { Api, GrammyError } from "grammy";
import { describe, expect, it } from "vitest";

import { telegramWidgetApi } from "../../src/adapters/telegram/telegram-widget-api.js";

interface RecordedCall {
  readonly url: string;
  readonly body: unknown;
}

/** A grammY client whose HTTP layer is a double; no request leaves the process. */
function recordingApi(result: unknown): { api: Api; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const api = new Api("synthetic", {
    fetch: (url: unknown, init?: { readonly body?: unknown }) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return Promise.resolve(
        new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  return { api, calls };
}

describe("Telegram widget methods through grammY 1.46.0", () => {
  it("calls sendWidget of Bot API 10.4, which grammY has no method for", async () => {
    const { api, calls } = recordingApi({
      ok: true,
      result: { message_id: 7 },
    });
    expect("sendWidget" in Api.prototype).toBe(false);

    const message = await telegramWidgetApi(api).sendWidget({
      chat_id: 4_503_599_627_370_495,
      html: "<div id=w></div>",
      chat_data: '["h",0,0,5,0]',
      caption: "Synthetic caption",
      allow_queries: true,
    });

    expect(message.message_id).toBe(7);
    expect(calls).toEqual([
      {
        url: "https://api.telegram.org/botsynthetic/sendWidget",
        body: {
          chat_id: 4_503_599_627_370_495,
          html: "<div id=w></div>",
          chat_data: '["h",0,0,5,0]',
          caption: "Synthetic caption",
          allow_queries: true,
        },
      },
    ]);
  });

  it("answers a widget query by its id", async () => {
    const { api, calls } = recordingApi({ ok: true, result: true });

    await telegramWidgetApi(api).answerWidgetQuery({
      widget_query_id: "8123456789012345678",
      data: '["h",1,1,5,0]',
    });

    expect(calls).toEqual([
      {
        url: "https://api.telegram.org/botsynthetic/answerWidgetQuery",
        body: {
          widget_query_id: "8123456789012345678",
          data: '["h",1,1,5,0]',
        },
      },
    ]);
  });

  it("reports a refused widget as a GrammyError with Telegram's description", async () => {
    const { api } = recordingApi({
      ok: false,
      error_code: 400,
      description: "Bad Request: INPUT_MEDIA_WIDGET_TOO_LARGE",
    });

    const refused = telegramWidgetApi(api).sendWidget({
      chat_id: 1,
      html: "<div id=w></div>",
    });

    await expect(refused).rejects.toBeInstanceOf(GrammyError);
    await expect(refused).rejects.toMatchObject({
      error_code: 400,
      description: "Bad Request: INPUT_MEDIA_WIDGET_TOO_LARGE",
      method: "sendWidget",
    });
  });
});
