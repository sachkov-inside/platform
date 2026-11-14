/** A one-pixel canvas the browser paints computed colours on. */
function pixel(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("The browser has no 2D canvas");
  return context;
}

/** RGBA bytes of the canvas pixel after painting `layers` bottom up, 0–255. */
function painted(
  layers: readonly string[],
): readonly [number, number, number, number] {
  const context = pixel();
  for (const layer of layers) {
    context.fillStyle = layer;
    context.fillRect(0, 0, 1, 1);
  }
  const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a];
}

/**
 * sRGB channels of any computed CSS colour (`rgb(…)`, `oklch(…)`…), 0–255: the browser paints it
 * on one canvas pixel and reads the pixel back.
 */
function channels(color: string): readonly [number, number, number] {
  const [r, g, b] = painted([color]);
  return [r, g, b];
}

/** WCAG relative luminance of a computed colour: 0 is black, 1 is white. */
export function luminance(color: string): number {
  const linear = (value: number) => {
    const c = value / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two opaque computed colours, from 1 to 21. */
export function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The opaque colour an element sits on: its own background and its ancestors' ones, painted from
 * the first opaque one up, so a translucent tint (`bg-background/70`) counts as the eye sees it.
 */
export function backgroundBehind(element: Element): string {
  const layers: string[] = [];
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    const color = getComputedStyle(node).backgroundColor;
    layers.unshift(color);
    if (painted([color])[3] === 255) break;
  }
  const [r, g, b] = painted(["#ffffff", ...layers]);
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

/** The contrast of an element's own text colour, translucent or not, on what lies behind it. */
export function textContrast(element: Element): number {
  const behind = backgroundBehind(element);
  const [r, g, b] = painted([behind, getComputedStyle(element).color]);
  return contrast(`rgb(${String(r)}, ${String(g)}, ${String(b)})`, behind);
}
