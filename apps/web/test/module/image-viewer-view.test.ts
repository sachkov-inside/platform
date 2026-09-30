import { describe, expect, it } from "vitest";

import {
  FIT_VIEW,
  clampView,
  fittedSize,
  maxZoom,
  panBy,
  toggleZoomAt,
  zoomAt,
} from "@/features/material-assets/model/image-viewer-view";

const image = { height: 1000, width: 1600 };
const stage = { height: 600, width: 400 };
const fitted = fittedSize(image, stage);
const limit = maxZoom(image, fitted);

describe("image viewer view", () => {
  it("fits the whole image into the stage without enlarging a small one", () => {
    expect(fitted).toEqual({ height: 250, width: 400 });
    expect(fittedSize({ height: 300, width: 480 }, stage)).toEqual({
      height: 250,
      width: 400,
    });
    expect(
      fittedSize({ height: 100, width: 200 }, { height: 900, width: 1440 }),
    ).toEqual({ height: 100, width: 200 });
  });

  it("allows twice the image's own pixels within the 3–8 range", () => {
    expect(limit).toBe(8);
    expect(maxZoom(image, { height: 875, width: 1400 })).toBe(3);
  });

  it("keeps the point under the pointer in place while zooming", () => {
    const point = { x: 100, y: 50 };
    const zoomed = zoomAt(FIT_VIEW, 2, point, fitted, stage, limit);
    // The image point under the pointer was 100 px right of the centre; at ×2 it stays under it.
    expect(zoomed.scale).toBe(2);
    expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo(point.x);
  });

  it("keeps an image smaller than the stage centred and the edges of a larger one outside", () => {
    expect(
      clampView({ scale: 1, x: 90, y: -40 }, fitted, stage, limit),
    ).toEqual(FIT_VIEW);
    const zoomed = zoomAt(FIT_VIEW, 4, { x: 0, y: 0 }, fitted, stage, limit);
    // 1600×1000 on a 400×600 stage leaves 600 px of overflow on each side horizontally
    // and 200 px vertically.
    expect(panBy(zoomed, { x: 5000, y: -5000 }, fitted, stage, limit)).toEqual({
      scale: 4,
      x: 600,
      y: -200,
    });
  });

  it("stays between the fitted image and the zoom limit", () => {
    expect(zoomAt(FIT_VIEW, 0.2, { x: 0, y: 0 }, fitted, stage, limit)).toEqual(
      FIT_VIEW,
    );
    expect(
      zoomAt(FIT_VIEW, 50, { x: 0, y: 0 }, fitted, stage, limit).scale,
    ).toBe(limit);
  });

  it("toggles between the fitted image and a closer look on a double tap", () => {
    const closer = toggleZoomAt(FIT_VIEW, { x: 0, y: 0 }, fitted, stage, limit);
    expect(closer.scale).toBe(2.5);
    expect(toggleZoomAt(closer, { x: 0, y: 0 }, fitted, stage, limit)).toEqual(
      FIT_VIEW,
    );
  });
});
