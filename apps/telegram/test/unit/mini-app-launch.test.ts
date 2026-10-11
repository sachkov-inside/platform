import { describe, expect, it } from "vitest";

import { verifyMiniAppLaunch } from "../../src/modules/bot-sign-in/mini-app-launch.js";

// Independent Python stdlib HMAC vector; no live Telegram data or credentials.
const initData =
  "auth_date=1791504000&query_id=synthetic-mini-app-query&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Synthetic%22%7D&hash=e505d246e33ae19dc837906656ec994c94d757d90fde6c3dac0911c9084e1ac2";
const botToken = "461:synthetic-bot-token-not-a-credential";
const now = new Date("2026-10-09T00:00:00.000Z");

const invalidLaunches = [
  [
    "duplicate-user",
    "auth_date=1791504000&query_id=synthetic-mini-app-query&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Synthetic%22%7D&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Synthetic%22%7D&hash=bd534094cb1420f3145be9ca6ddf58fc69686a2e68b9be8defac9b10d1cb6ecd",
  ],
  [
    "duplicate-date",
    "auth_date=1791504000&query_id=synthetic-mini-app-query&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Synthetic%22%7D&auth_date=1791504000&hash=91e6231b4a1e61a519f0a88adfef19a8293e12f4db7c7ca80a1c0b7715a8da01",
  ],
  [
    "non-integer-date",
    "auth_date=1791504000.01&query_id=synthetic-mini-app-query&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Synthetic%22%7D&hash=768ec8659bff1b56c47032826253c354091b9abe856879948a520f2ae958ca2d",
  ],
  [
    "missing-user",
    "auth_date=1791504000&query_id=synthetic-mini-app-query&hash=03b7be8aa28efd3f64923a035f1f1940a7ea5c316fa203138aaa75984ed3842f",
  ],
  [
    "bot-user",
    "auth_date=1791504000&query_id=synthetic-mini-app-query&user=%7B%22id%22%3A42%2C%22is_bot%22%3Atrue%7D&hash=253f2fddde7e620f96282016af5eac52ecd5d193683a6d0574afaecbc8adbf9a",
  ],
  [
    "unsafe-user-id",
    "auth_date=1791504000&query_id=synthetic-mini-app-query&user=%7B%22id%22%3A9007199254740992%7D&hash=95cfe144012c8969065cf3089e324c668ecc1b4df8653d3ae03f52cb16efd49c",
  ],
  [
    "malformed-user",
    "auth_date=1791504000&query_id=synthetic-mini-app-query&user=%7Bbroken&hash=601d87991f9f2357daf3da5a63386733afc14e8c4c655ea037cacd28bac87191",
  ],
] as const;

describe("Mini App launch proof", () => {
  it("accepts a fresh signed human identity without turning profile data into ownership", () => {
    expect(verifyMiniAppLaunch({ initData, botToken, now })).toMatchObject({
      telegramUserId: "42",
      authenticatedAt: now,
    });
  });

  it("rejects an old launch and excessive future clock skew", () => {
    expect(
      verifyMiniAppLaunch({
        initData,
        botToken,
        now: new Date("2026-10-09T00:05:00.001Z"),
      }),
    ).toBeUndefined();
    expect(
      verifyMiniAppLaunch({
        initData,
        botToken,
        now: new Date("2026-10-08T23:59:29.999Z"),
      }),
    ).toBeUndefined();
  });
  it.each(invalidLaunches)(
    "rejects signed malformed launch %s",
    (_label, proof) => {
      expect(
        verifyMiniAppLaunch({ initData: proof, botToken, now }),
      ).toBeUndefined();
    },
  );

  it("rejects forged data and a proof for another bot", () => {
    expect(
      verifyMiniAppLaunch({
        initData: initData.replace("42", "43"),
        botToken,
        now,
      }),
    ).toBeUndefined();
    expect(
      verifyMiniAppLaunch({
        initData,
        botToken: "462:other-synthetic-bot",
        now,
      }),
    ).toBeUndefined();
  });

  it("gives one replay key for reordered launch fields", () => {
    const reordered = initData.split("&").reverse().join("&");
    expect(
      verifyMiniAppLaunch({ initData: reordered, botToken, now })?.proofDigest,
    ).toBe(verifyMiniAppLaunch({ initData, botToken, now })?.proofDigest);
  });
});
