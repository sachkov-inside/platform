import { expect } from "storybook/test";

/**
 * «Проверить» before an answer reads as «not yet», not as a broken control: a full-strength
 * graphite outline with quiet text instead of a faded grey block.
 */
export async function expectCalmDisabledCheck(button: HTMLElement) {
  await expect(button).toBeDisabled();
  const style = getComputedStyle(button);
  await expect(style.opacity).toBe("1");
  await expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  await expect(style.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  await expect(style.color).not.toBe("rgb(255, 255, 255)");
}
