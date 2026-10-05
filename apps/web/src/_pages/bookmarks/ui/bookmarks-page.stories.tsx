import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense } from "react";
import { expect, waitFor } from "storybook/test";

import type { MaterialPreview } from "@/entities/material";
import { getQueryClient } from "@/shared/api/query-client";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import {
  fetchBeforeRender,
  type MutationFetch,
} from "@/storybook/mutation-mock";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { BookmarksLoading, BookmarksPage } from "./bookmarks-page";
import { BookmarksPageQuery } from "./bookmarks-page-query.client";

function material(
  index: number,
  slug: string,
  title: string,
  format: { readonly name: string; readonly slug: string },
  durationSeconds?: number,
): MaterialPreview {
  const id = String(index).padStart(12, "0");
  return {
    materialId: `02000000-0000-4000-8000-${id}`,
    access: "free",
    availability: "available",
    cover: {
      coverId: `27100000-0000-4000-8000-${id}`,
      renditions: [
        { width: 960, height: durationSeconds === undefined ? 960 : 540 },
      ],
    },
    format: format.name,
    formatSlug: format.slug,
    ...(durationSeconds === undefined
      ? {}
      : { primaryVideoDurationSeconds: durationSeconds }),
    seriesMemberships: [],
    slug,
    summary:
      "Практический разбор: от понятных границ к работающему приложению.",
    tags: [],
    title,
    topic: "Архитектура",
    topicSlug: "platform",
  };
}

const video = { name: "Видео", slug: "video" } as const;
const guide = { name: "Гайд", slug: "guide" } as const;
const savedMaterials = [
  material(
    5,
    "produkt-i-inzhenernyy-kontekst",
    "Продукт и инженерный контекст",
    video,
    754,
  ),
  material(
    6,
    "glubokie-moduli-na-praktike",
    "Глубокие модули на практике",
    video,
    481,
  ),
  material(1, "granitsy-moduley", "Границы модулей без лишних слоёв", guide),
];

/** Тот же ответ, что отдаёт BFF `/api/bookmarks` маршруту. */
function bookmarksResponse(
  status: number,
  body?: unknown,
): ReturnType<MutationFetch> {
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    }),
  );
}

const readyList: MutationFetch = () =>
  bookmarksResponse(200, { items: savedMaterials, nextCursor: null });

type Account = "authenticated" | "guest";

/** Карточки списка; у футера оболочки свои пункты, их счёт не касается страницы. */
function savedItems(canvasElement: HTMLElement) {
  return canvasElement.querySelectorAll("[data-bookmarks-page] li");
}

/**
 * Маршрут `/bookmarks`: `BookmarksPage` в публичной оболочке, внутри — запрос списка в той же
 * границе Suspense, что в `page.tsx`. Ответ BFF ставится до первого рендера, кеш списка общий на
 * все истории и перед каждой очищается.
 */
function bookmarksRoute(
  account: Account,
  respond: MutationFetch,
): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  const environment = publicPageEnvironment("/bookmarks", { account });
  return {
    beforeEach: () => {
      environment.beforeEach();
      getQueryClient().removeQueries({ queryKey: ["bookmarks"] });
      return fetchBeforeRender(respond)();
    },
    decorators: environment.decorators,
    parameters: environment.parameters,
  };
}

const meta = {
  component: BookmarksPage,
  title: "Pages/Bookmarks",
  tags: ["autodocs"],
  args: { children: null },
  render: () => (
    <BookmarksPage>
      <Suspense fallback={<BookmarksLoading />}>
        <BookmarksPageQuery />
      </Suspense>
    </BookmarksPage>
  ),
} satisfies Meta<typeof BookmarksPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SavedDesktop: Story = {
  ...bookmarksRoute("authenticated", readyList),
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Закладки" }),
    ).toBeVisible();
    await expect(
      await page.findByRole("link", { name: /Глубокие модули на практике/u }),
    ).toBeVisible();
    await expect(savedItems(canvasElement)).toHaveLength(savedMaterials.length);
  },
};

export const SavedMobile: Story = {
  ...SavedDesktop,
  globals: mobile.globals,
};

/** Следующая страница списка открывается кнопкой под ним. */
export const MorePages: Story = {
  ...bookmarksRoute("authenticated", (input) =>
    (input instanceof Request ? input.url : input.toString()).includes("after=")
      ? bookmarksResponse(200, { items: [], nextCursor: null })
      : bookmarksResponse(200, {
          items: savedMaterials,
          nextCursor: "cursor-2",
        }),
  ),
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("button", { name: "Показать ещё" }),
    ).toBeVisible();
  },
};

export const Empty: Story = {
  ...bookmarksRoute("authenticated", () =>
    bookmarksResponse(200, { items: [], nextCursor: null }),
  ),
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { level: 2, name: "Пока пусто" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Открыть материалы" }),
    ).toHaveAttribute("href", "/");
  },
};

/** Гость: BFF отвечает 401, страница предлагает войти. */
export const SignInRequired: Story = {
  ...bookmarksRoute("guest", () => bookmarksResponse(401)),
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { level: 2, name: "Войдите в аккаунт" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  },
};

export const Unavailable: Story = {
  ...bookmarksRoute("authenticated", () => bookmarksResponse(503)),
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Закладки временно недоступны",
    );
  },
};

/** `loading.tsx`: та же рамка страницы со скелетом списка. */
export const Loading: Story = {
  ...bookmarksRoute("authenticated", readyList),
  globals: desktop.globals,
  render: () => (
    <BookmarksPage>
      <BookmarksLoading />
    </BookmarksPage>
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("status")).toHaveTextContent(
      "Загружаем закладки…",
    );
  },
};

/** Ответ списка ждёт, пока проверка не измерит скелет. */
let deliverList: () => void = () => undefined;

function heldList(): MutationFetch {
  const delivered = new Promise<void>((resolve) => {
    deliverList = resolve;
  });
  return async (input, init) => {
    await delivered;
    return readyList(input, init);
  };
}

/** Скелет стоит в рамке страницы: заголовок и начало списка не сдвигаются, когда список пришёл. */
function loadsInPlace({
  globals,
  width,
}: StoryViewport): Pick<
  Story,
  "beforeEach" | "decorators" | "globals" | "parameters" | "play"
> {
  const environment = publicPageEnvironment("/bookmarks", {
    account: "authenticated",
  });
  return {
    beforeEach: () => {
      environment.beforeEach();
      getQueryClient().removeQueries({ queryKey: ["bookmarks"] });
      return fetchBeforeRender(heldList())();
    },
    decorators: environment.decorators,
    parameters: environment.parameters,
    globals,
    play: async ({ canvasElement }) => {
      await settleStoryFrame(width);
      const page = routeContent(canvasElement);
      await expect(page.getByRole("status")).toHaveTextContent(
        "Загружаем закладки…",
      );
      const skeleton = {
        header: boxOf(canvasElement, "[data-bookmarks-page] > header"),
        content: originOf(
          boxOf(canvasElement, "[data-bookmarks-page] > header + div"),
        ),
      };

      deliverList();
      await waitFor(() =>
        expect(savedItems(canvasElement)).toHaveLength(savedMaterials.length),
      );
      const ready = {
        header: boxOf(canvasElement, "[data-bookmarks-page] > header"),
        content: originOf(
          boxOf(canvasElement, "[data-bookmarks-page] > header + div"),
        ),
      };

      await expect(ready).toEqual(skeleton);
    },
  };
}

export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
