import { describe, expect, it } from "vitest";
import { translateCommunityMessage } from "../../src/adapters/telegram/grammy-community-message.adapter.js";
import { loadCommunityDiscussionsConfig } from "../../src/config/community-discussions-config.js";

describe("community audio intake", () => {
  it.each(["voice", "video_note"] as const)(
    "captures %s metadata without downloading the file",
    (kind) => {
      const input = translateCommunityMessage("inside", "11", {
        message: {
          message_id: 10,
          date: 1791363600,
          chat: { id: -1000000000000, type: "supergroup" },
          from: { id: 42, is_bot: false },
          [kind]: { file_id: "synthetic-file", duration: 23 },
        },
      });
      expect(input).toMatchObject({
        kind,
        text: "",
        fileId: "synthetic-file",
        durationSeconds: 23,
      });
    },
  );
  it("loads independent transcription credentials", () => {
    expect(
      loadCommunityDiscussionsConfig({
        TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
        COMMUNITY_DISCUSSIONS_TRANSCRIPTION_BASE_URL:
          "http://127.0.0.1:19999/v1",
        COMMUNITY_DISCUSSIONS_TRANSCRIPTION_API_KEY:
          "synthetic-transcription-key",
        COMMUNITY_DISCUSSIONS_TRANSCRIPTION_MODEL:
          "synthetic-transcription-model",
      }),
    ).toMatchObject({
      transcription: {
        baseUrl: "http://127.0.0.1:19999/v1",
        apiKey: "synthetic-transcription-key",
        model: "synthetic-transcription-model",
      },
    });
  });
});
