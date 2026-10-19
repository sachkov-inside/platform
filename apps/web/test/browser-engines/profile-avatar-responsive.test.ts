import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, expect as browserExpect } from "@playwright/test";
import { expect, test } from "vitest";
import { ProfileAvatar } from "@/entities/member-profile/ui/profile-avatar.client";

test("avatars select existing renditions for the displayed size and screen density", async () => {
  const browser = await chromium.launch();
  try {
    for (const [size, viewport, dpr, expected] of [
      ["header", 390, 1, 160],
      ["header", 1440, 3, 160],
      ["large", 390, 2, 160],
      ["large", 1440, 2, 320],
      ["large", 1440, 4, 640],
    ] as const) {
      const context = await browser.newContext({
        viewport: { width: viewport, height: 900 },
        deviceScaleFactor: dpr,
      });
      try {
        const requests: string[] = [];
        await context.route("https://images.example.test/**", (route) => {
          requests.push(route.request().url());
          return route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="blue"/></svg>',
          });
        });
        const page = await context.newPage();
        await page.setContent(
          '<base href="https://images.example.test/">' +
            renderToStaticMarkup(
              createElement(ProfileAvatar, {
                avatar: { avatarId: "avatar" },
                displayName: "Участник",
                size,
              }),
            ),
        );
        const img = page.getByRole("img", { name: "Аватар: Участник" });
        await browserExpect(img).toHaveJSProperty("complete", true);
        expect(
          await img.evaluate(
            (node: HTMLImageElement) => new URL(node.currentSrc).pathname,
          ),
        ).toBe(`/api/account/profile/avatar/avatar/${String(expected)}`);
        expect(requests).toEqual([
          `https://images.example.test/api/account/profile/avatar/avatar/${String(expected)}`,
        ]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
