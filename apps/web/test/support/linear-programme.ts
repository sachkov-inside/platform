import { expect, type Page } from "@playwright/test";
import { z } from "zod";

/** An authored programme return keeps its occurrence identity as well as its page and Material. */
export function expectProgrammeReturnTarget(
  actual: string | null,
  expected: string,
): string {
  if (actual === null) throw new Error("Missing programme return target");
  const target = new URL(actual, "https://inside.test");
  const wanted = new URL(expected, "https://inside.test");
  expect(target.origin).toBe(wanted.origin);
  expect(target.pathname).toBe(wanted.pathname);
  expect(target.hash).toBe(wanted.hash);
  z.uuid().parse(target.searchParams.get("atPlacement"));
  if (!wanted.searchParams.has("atPlacement"))
    target.searchParams.delete("atPlacement");
  target.searchParams.sort();
  wanted.searchParams.sort();
  expect(target.search).toBe(wanted.search);
  return actual;
}

/** Flat legacy Products keep linear navigation without a course chapter frame. */
export async function expectLinearProgrammeReturn(
  page: Page,
  mobile: boolean,
  href: string,
) {
  await expect(page.locator("[data-course-reading]")).toHaveCount(0);
  const top = page.getByRole("navigation", {
    name: "Действия материала",
    exact: true,
  });
  const bottom = page.getByRole("navigation", {
    name: "Действия в конце материала",
    exact: true,
  });
  for (const actions of [top, bottom]) {
    await expect(actions).toHaveCount(1);
    await expect(
      actions.getByRole("link", { name: "Назад", exact: true }),
    ).toHaveAttribute("href", href);
  }
  const dock = page.getByRole("navigation", {
    name: "Уроки продукта",
    exact: true,
  });
  if (mobile) {
    await expect(dock).toBeVisible();
    await expect(
      dock.getByRole("link", { name: /^Программа, урок /u }),
    ).toHaveAttribute("href", href);
  } else await expect(dock).toBeHidden();
  const action = top.getByRole("link", {
    name: "Назад",
    exact: true,
  });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  return action;
}
