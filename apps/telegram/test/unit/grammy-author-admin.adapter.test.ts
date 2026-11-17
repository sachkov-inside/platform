import { describe, expect, it } from "vitest";
import { translateAuthorInput } from "../../src/adapters/telegram/grammy-author-admin.adapter.js";

function press(bot: unknown) {
  return {
    callback_query: {
      id: "press-1",
      data: "author:menu:0",
      from: { id: 10001, is_bot: false, username: "visitor_name" },
      message: {
        message_id: 7,
        from: bot,
        chat: { id: 10001, type: "private" },
      },
    },
  };
}

describe("author bot profile", () => {
  it("takes the entry-link username from the bot message, not the visitor", () => {
    expect(
      translateAuthorInput(
        "inside",
        "1",
        press({
          id: 20001,
          is_bot: true,
          username: "inside_demo_bot",
        }),
      ),
    ).toMatchObject({
      botUsername: "inside_demo_bot",
      telegramUserId: "10001",
    });
  });

  it.each([
    ["a missing author", undefined],
    ["a human", { id: 20001, is_bot: false, username: "visitor_name" }],
    [
      "an unsafe name",
      { id: 20001, is_bot: true, username: "demo_bot?start=other" },
    ],
  ])("keeps legacy input without a link profile for %s", (_label, bot) => {
    const input = translateAuthorInput("inside", "1", press(bot));
    expect(input).toBeDefined();
    expect(input).not.toHaveProperty("botUsername");
  });
});
