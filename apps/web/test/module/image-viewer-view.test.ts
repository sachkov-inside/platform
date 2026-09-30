import { describe, expect, it } from "vitest";

import {
  FIT_VIEW,
  clampView,
  isOnImage,
  panBy,
  pinchView,
  toggleZoomAt,
  viewerBounds,
  zoomAt,
} from "@/features/material-assets/model/image-viewer-view";

const centre = { x: 0, y: 0 };
const bounds = viewerBounds(
  { height: 1000, width: 1600 },
  { height: 600, width: 400 },
);

describe("image viewer view", () => {
  it("fits the whole image into the stage without enlarging a small one", () => {
    expect(bounds.fitted).toEqual({ height: 250, width: 400 });
    expect(
      viewerBounds({ height: 300, width: 480 }, bounds.stage).fitted,
    ).toEqual({ height: 250, width: 400 });
    expect(
      viewerBounds({ height: 100, width: 200 }, { height: 900, width: 1440 })
        .fitted,
    ).toEqual({ height: 100, width: 200 });
  });

  it("allows twice the image's own pixels within the 3–8 range", () => {
    expect(bounds.limit).toBe(8);
    expect(
      viewerBounds({ height: 1000, width: 1600 }, { height: 875, width: 1400 })
        .limit,
    ).toBe(3);
  });

  it("keeps the point under the pointer in place while zooming", () => {
    const point = { x: 100, y: 50 };
    const zoomed = zoomAt(FIT_VIEW, 2, point, bounds);
    // The image point under the pointer was 100 px right of the centre; at ×2 it stays under it.
    expect(zoomed.scale).toBe(2);
    expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo(point.x);
  });

  it("keeps an image smaller than the stage centred and the edges of a larger one outside", () => {
    expect(clampView({ scale: 1, x: 90, y: -40 }, bounds)).toEqual(FIT_VIEW);
    const zoomed = zoomAt(FIT_VIEW, 4, centre, bounds);
    // 1600×1000 on a 400×600 stage leaves 600 px of overflow on each side horizontally
    // and 200 px vertically.
    expect(panBy(zoomed, { x: 5000, y: -5000 }, bounds)).toEqual({
      scale: 4,
      x: 600,
      y: -200,
    });
  });

  it("limits a pinch near the edge once, so the image follows the fingers", () => {
    // Fingers spread from 150 px right of the centre and slide back by 100 px. Clamping the zoom
    // first would pin x to the edge (150) and then subtract the slide, leaving the image behind.
    const pinched = pinchView(
      FIT_VIEW,
      2,
      { x: 150, y: 0 },
      { x: -100, y: 0 },
      bounds,
    );
    expect(pinched).toEqual({ scale: 2, x: -250 + 50, y: 0 });
  });

  it("stays between the fitted image and the zoom limit", () => {
    expect(zoomAt(FIT_VIEW, 0.2, centre, bounds)).toEqual(FIT_VIEW);
    expect(zoomAt(FIT_VIEW, 50, centre, bounds).scale).toBe(bounds.limit);
  });

  it("toggles between the fitted image and a closer look on a double tap", () => {
    const closer = toggleZoomAt(FIT_VIEW, centre, bounds);
    expect(closer.scale).toBe(2.5);
    expect(toggleZoomAt(closer, centre, bounds)).toEqual(FIT_VIEW);
  });

  it("tells a press on the image from a press on the background", () => {
    expect(isOnImage({ x: 190, y: 120 }, FIT_VIEW, bounds)).toBe(true);
    expect(isOnImage({ x: 0, y: 200 }, FIT_VIEW, bounds)).toBe(false);
    expect(isOnImage({ x: 0, y: 200 }, { scale: 2, x: 0, y: 0 }, bounds)).toBe(
      true,
    );
  });
});
