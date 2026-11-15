import { expect } from "storybook/test";

/**
 * Touch extent of a control: its box, or the wider hit area the shared Button adds on phones
 * through `::after` around a 36 px visible surface (web-presentation, mobile control density).
 */
function touchHeight(control: HTMLElement): number {
  const after = Number.parseFloat(getComputedStyle(control, "::after").height);
  return Math.max(
    control.getBoundingClientRect().height,
    Number.isNaN(after) ? 0 : after,
  );
}

/**
 * A phone layout holds: the page has no horizontal scroll, no item overflows its box, and every
 * enabled control inside `root` can be touched over at least 44 px.
 */
export async function expectPhoneLayout(
  root: HTMLElement,
  itemSelector: string,
): Promise<void> {
  for (const item of root.querySelectorAll<HTMLElement>(itemSelector))
    await expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth);
  for (const control of root.querySelectorAll<HTMLElement>(
    "select:enabled, button:enabled",
  ))
    await expect(touchHeight(control)).toBeGreaterThanOrEqual(44);
  await expect(document.documentElement.scrollWidth).toBe(
    document.documentElement.clientWidth,
  );
}

/**
 * Крупный системный шрифт (`<meta name="text-scale">`): корневой размер вырастает вдвое, а страница
 * всё равно не прокручивается вбок. Чтение `scrollWidth` сразу пересчитывает раскладку; после
 * проверки размер возвращается.
 */
export async function expectNoSidewaysScrollAtDoubleText(): Promise<void> {
  const root = document.documentElement;
  const fontSize = root.style.fontSize;
  try {
    root.style.fontSize = "200%";
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  } finally {
    root.style.fontSize = fontSize;
  }
}
