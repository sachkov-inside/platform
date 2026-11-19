import { productPath } from "@/shared/routing/public-page-path";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { z } from "zod";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { internalRoute } from "@/shared/routing/internal-route";
import {
  enterReaderHistory,
  prepareReaderHistory,
  readerHistoryEntryEvent,
  resetReaderHistoryActivation,
} from "@/shared/lib/reader-history";
import { Breadcrumbs } from "./breadcrumbs";
import { IntentPrefetchLink } from "./intent-prefetch-link.client";

const meta = {
  ...publicPageEnvironment("/materials/brief"),
  id: "shared-breadcrumbs",
  title: "Components/Navigation/Breadcrumbs",
  component: Breadcrumbs,
  args: {
    items: [
      { label: "AI Engineering", href: productPath("ai-engineering") },
      {
        label: "Глава 1",
        fullLabel: "Подготовь проект к разработке",
        href: productProgrammeHref("ai-engineering"),
      },
      {
        label: "Задание",
        fullLabel: "Подготовь проект к работе с агентом",
        href: productTaskHref("ai-engineering", "aie-ch1-harness"),
        restoreOrigin: true,
      },
      { label: "Бриф заказчика" },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CourseLocation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation", { name: "Хлебные крошки" });
    await expect(within(nav).getAllByRole("link")).toHaveLength(3);
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(
      "Бриф заказчика",
    );
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBe(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
export const Mobile: Story = {
  ...CourseLocation,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const LongTitles: Story = {
  args: {
    items: [
      { label: "AI Engineering", href: productPath("ai-engineering") },
      { label: "Глава 1", href: productProgrammeHref("ai-engineering") },
      { label: "Как устроен пайплайн разработки с агентом" },
    ],
  },
  play: async ({ canvasElement }) => {
    const current = canvasElement.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (current === null) throw new Error("Current breadcrumb is missing");
    await expect(current).toHaveAttribute(
      "title",
      "Как устроен пайплайн разработки с агентом",
    );
    await expect(current.scrollWidth).toBeGreaterThan(current.clientWidth);
    await expect(getComputedStyle(current).textOverflow).toBe("ellipsis");
  },
};
export const LongTitlesMobile: Story = {
  ...LongTitles,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

/**
 * На телефоне компактные крошки урока показывают курс и текущий урок, а середину сворачивают в
 * многоточие: читатель видит, где он, и не теряет название урока.
 */
export const CompactLessonMobile: Story = {
  args: {
    compact: true,
    items: [
      {
        label: "Демо: интерактивные уроки",
        href: productPath("ai-engineering"),
      },
      {
        label: "Глава 1",
        fullLabel: "Подготовь проект к разработке",
        href: productProgrammeHref("ai-engineering"),
      },
      { label: "Витрина: как выглядит материал" },
    ],
  },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation", { name: "Хлебные крошки" });
    const course = within(nav).getByRole("link", {
      name: "Демо: интерактивные уроки",
    });
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (current === null) throw new Error("Current breadcrumb is missing");
    await expect(course).toBeVisible();
    await expect(current).toBeVisible();
    await expect(current).toHaveTextContent("Витрина: как выглядит материал");
    // The course keeps enough room to be recognised; the lesson takes the rest.
    await expect(course.getBoundingClientRect().width).toBeGreaterThan(80);
    await expect(current.getBoundingClientRect().width).toBeGreaterThan(120);
    // The chapter stays reachable for assistive technology but folds into an ellipsis.
    const chapter = within(nav).getByRole("link", {
      name: "Глава 1: Подготовь проект к разработке",
    });
    await expect(chapter.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expect(within(nav).getByText("…")).toBeVisible();
    const box = nav.getBoundingClientRect();
    await expect(current.getBoundingClientRect().top - box.top).toBeLessThan(
      24,
    );
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBe(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

/** На широком экране компактные крошки показывают весь путь без многоточия. */
export const CompactLessonDesktop: Story = {
  ...CompactLessonMobile,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole("navigation", {
      name: "Хлебные крошки",
    });
    await expect(within(nav).getAllByRole("link")).toHaveLength(2);
    for (const link of within(nav).getAllByRole("link"))
      await expect(link).toBeVisible();
    await expect(within(nav).queryByText("…")).not.toBeVisible();
  },
};

const originTask = productTaskHref("origin-story", "practice");
const originReference = internalRoute("/materials/origin-story?anchor=proof");

function OriginHistory() {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setVisible((current) => !current);
        }}
      >
        {visible ? "Скрыть крошки" : "Вернуть крошки"}
      </button>
      <IntentPrefetchLink href={originReference} data-origin-fixture="first">
        Открыть памятку из первого ответа
      </IntentPrefetchLink>
      <IntentPrefetchLink href={originReference} data-origin-fixture="second">
        Открыть памятку из второго ответа
      </IntentPrefetchLink>
      <Activity mode={visible ? "visible" : "hidden"}>
        <Breadcrumbs
          items={[
            { label: "Задание", href: originTask, restoreOrigin: true },
            { label: "Памятка" },
          ]}
        />
      </Activity>
    </>
  );
}

/** One focused case owns this file's isolated Vitest iframe, never the owner's History. */
export const OriginHistoryRetained: Story = {
  render: () => <OriginHistory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const history = window.history;
    const originalHref = window.location.href;
    const originalState: unknown = history.state;
    const originalReplace = history.replaceState.bind(history);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      history,
      "replaceState",
    );
    const first = canvasElement.querySelector<HTMLAnchorElement>(
      '[data-origin-fixture="first"]',
    );
    const second = canvasElement.querySelector<HTMLAnchorElement>(
      '[data-origin-fixture="second"]',
    );
    if (first === null || second === null)
      throw new Error("Missing origin links");
    const link = canvas.getByRole("link", { name: "Задание" });
    const events: string[] = [];
    const createdStorage = new Set<string>();
    let phase = "initial";
    const observe = () => {
      events.push(phase);
    };
    const navigate = (source: string) => (event: MouseEvent) => {
      history.replaceState({}, "", source);
      enterReaderHistory(undefined, canvasElement);
      const current = z
        .object({ insideReader: z.object({ id: z.uuid() }) })
        .parse(history.state);
      const storageKey = `inside-reader-entry:${current.insideReader.id}`;
      if (sessionStorage.getItem(storageKey) === null)
        createdStorage.add(storageKey);
      prepareReaderHistory(event, undefined, canvasElement);
      event.preventDefault();
      history.replaceState({}, "", first.href);
      enterReaderHistory(originTask, canvasElement);
    };
    const openFirst = navigate(
      "/products/origin-story/tasks/practice?attemptsAfter=first#submission",
    );
    const openSecond = navigate(
      "/products/origin-story/tasks/practice?attemptsAfter=second#answer",
    );
    window.addEventListener(readerHistoryEntryEvent, observe);
    first.addEventListener("click", openFirst);
    second.addEventListener("click", openSecond);
    try {
      await userEvent.click(first);
      await waitFor(() =>
        expect(link).toHaveAttribute(
          "href",
          "/products/origin-story/tasks/practice?attemptsAfter=first#submission",
        ),
      );
      await userEvent.click(
        canvas.getByRole("button", { name: "Скрыть крошки" }),
      );
      await expect(link).not.toBeVisible();
      await expect(link.isConnected).toBe(true);
      phase = "hidden";
      await userEvent.click(second);
      await expect(events).toContain("hidden");
      await expect(link).toHaveAttribute(
        "href",
        "/products/origin-story/tasks/practice?attemptsAfter=first#submission",
      );
      phase = "returned";
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуть крошки" }),
      );
      await waitFor(() =>
        expect(link).toHaveAttribute(
          "href",
          "/products/origin-story/tasks/practice?attemptsAfter=second#answer",
        ),
      );
      await expect(canvas.getByRole("link", { name: "Задание" })).toBe(link);
      await expect(link).toBeVisible();
      phase = "foreign";
      // Synthetic browser-state input, never navigated to or executed as application code.
      history.replaceState(
        {
          insideReader: {
            id: crypto.randomUUID(),
            href: window.location.href,
            origin: {
              id: crypto.randomUUID(),
              href: "https://outside.invalid/products/origin-story/tasks/practice?attemptsAfter=foreign#answer",
            },
          },
        },
        "",
      );
      enterReaderHistory(originTask, canvasElement);
      await expect(events).toContain("foreign");
      await waitFor(() => expect(link).toHaveAttribute("href", originTask));
      console.info(
        "READER_ORIGIN_BASELINE",
        JSON.stringify({
          sameLink: true,
          hiddenEntryObserved: events.includes("hidden"),
          hiddenHref: "first#submission",
          returnedHref: "second#answer",
          foreignFallback: true,
        }),
      );
    } finally {
      first.removeEventListener("click", openFirst);
      second.removeEventListener("click", openSecond);
      window.removeEventListener(readerHistoryEntryEvent, observe);
      resetReaderHistoryActivation();
      for (const key of createdStorage) sessionStorage.removeItem(key);
      // enterReaderHistory installs its real preservation hook. Restore the method and URL;
      // its permanent document listener dies with this focused file's normal iframe teardown.
      if (originalDescriptor === undefined)
        Reflect.deleteProperty(history, "replaceState");
      else Object.defineProperty(history, "replaceState", originalDescriptor);
      originalReplace(originalState, "", originalHref);
    }
  },
};
