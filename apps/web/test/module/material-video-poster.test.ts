import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

import { MaterialVideoPlayerView } from "@/features/material-video/ui/material-primary-video.client";

const cover = {
  coverId: "cover-test",
  renditions: [{ width: 1280, height: 720 }],
};

test("the player presents the Material cover and an accessible start action before playback", () => {
  const html = renderToStaticMarkup(
    createElement(MaterialVideoPlayerView, {
      cover,
      onStart: vi.fn(),
      onLoad: vi.fn(),
      phase: "playing",
      title: "Урок",
      videoId: "video-test",
      showPoster: true,
    }),
  );
  expect(html).toContain("/api/content-covers/cover-test/1280");
  expect(html).toContain('aria-label="Смотреть видео: Урок"');
});

for (const state of ["started", "error", "no-cover"] as const) {
  test(`the cover does not obstruct ${state} controls`, () => {
    const html = renderToStaticMarkup(
      createElement(MaterialVideoPlayerView, {
        cover: state === "no-cover" ? null : cover,
        onLoad: vi.fn(),
        phase: state === "error" ? "error" : "playing",
        title: "Урок",
        videoId: "video-test",
        showPoster: state !== "started",
      }),
    );
    expect(html).not.toContain('aria-label="Смотреть видео: Урок"');
    if (state === "error") expect(html).toContain("Повторить");
  });
}
