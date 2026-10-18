import { expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { proxy, config } from "../../proxy";
it("returns to the Product intent after provider logout and consumes its navigation cookie", () => {
  expect(
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/" }),
  ).toBe(true);
  const response = proxy(
    new NextRequest("https://inside.example.test/", {
      headers: {
        cookie:
          "inside.logout-return=%2Ftelegram%2Fcontinue%3Fattempt%3Dopaque",
      },
    }),
  );
  expect(response.headers.get("location")).toBe(
    "https://inside.example.test/telegram/continue?attempt=opaque",
  );
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("does not follow an external logout return", () => {
  const response = proxy(
    new NextRequest("https://inside.example.test/", {
      headers: { cookie: "inside.logout-return=https%3A%2F%2Fevil.example%2F" },
    }),
  );
  expect(response.headers.get("location")).toBeNull();
});
