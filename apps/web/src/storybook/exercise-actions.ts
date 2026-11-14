import { expect } from "storybook/test";

import {
  backgroundBehind,
  contrast,
  luminance,
  textContrast,
} from "./contrast";

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

/** Elements that paint their own words: a text node of their own, on screen and not hidden. */
function wordsOnScreen(root: HTMLElement): readonly HTMLElement[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].filter(
    (element) => {
      const ownWords = [...element.childNodes].some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          (node.textContent ?? "").trim() !== "",
      );
      if (!ownWords || element.closest(":disabled") !== null) return false;
      const box = element.getBoundingClientRect();
      return (
        box.width > 1 &&
        box.height > 1 &&
        element.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        })
      );
    },
  );
}

/**
 * An exercise is a dark graphite block (owner decision 14.11.2026) that reads at WCAG AA: every
 * word on screen reaches 4.5:1 on what lies behind it, the ✓ and ✕ marks and the focus ring reach
 * 3:1. Folded «Почему» explanations are opened first, so their text is measured too.
 */
export async function expectReadableDarkExercise(root: HTMLElement) {
  const exercise = root.matches("[data-material-exercise]")
    ? root
    : root.querySelector<HTMLElement>("[data-material-exercise]");
  if (exercise === null) throw new Error("No exercise on the page");
  await expect(exercise).toHaveAttribute("data-lesson-dark");
  const block = getComputedStyle(exercise).backgroundColor;
  await expect(luminance(block)).toBeLessThan(0.05);
  for (const details of exercise.querySelectorAll("details"))
    details.open = true;
  const words = wordsOnScreen(exercise);
  await expect(words.length).toBeGreaterThan(0);
  for (const element of words) {
    const ratio = textContrast(element);
    if (ratio < 4.5)
      throw new Error(
        `«${element.textContent.trim().slice(0, 40)}» reads at ${ratio.toFixed(2)}:1`,
      );
  }
  for (const mark of exercise.querySelectorAll<SVGElement>(
    "[data-item-mark] svg, [data-exercise-verdict] svg",
  ))
    await expect(
      contrast(getComputedStyle(mark).color, backgroundBehind(mark)),
    ).toBeGreaterThanOrEqual(3);
  await expect(
    contrast(getComputedStyle(exercise).getPropertyValue("--ring"), block),
  ).toBeGreaterThanOrEqual(3);
}
