import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { expect, waitFor, within } from "storybook/test";

import { fetchBeforeRender } from "@/workshop/mutation-mock";

import { SavedBookmarkAction } from "./saved-bookmark-action.client";

const materialId = "10000000-0000-4000-8000-000000000542";
const bookmarkedState = {
  bookmarked: true,
  bookmarkedAt: "2026-09-12T00:00:00.000Z",
  materialId,
};

/** Пути, которые адаптер запросил за прогон story: у гостя их не должно быть ни одного. */
const requestedPaths: string[] = [];

function recordedFetch(respond: () => Response) {
  return () => {
    requestedPaths.length = 0;
    return fetchBeforeRender((input) => {
      const target = input instanceof Request ? input.url : String(input);
      requestedPaths.push(new URL(target, window.location.origin).pathname);
      return Promise.resolve(respond());
    })();
  };
}

/** Своё хранилище запросов на story: общий клиент приложения переносил бы ответы между ними. */
function BookmarkScope({ children }: { readonly children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <div className="flex min-h-40 items-start justify-end p-8">{children}</div>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Features/Bookmarks adapter",
  component: SavedBookmarkAction,
  args: { materialId },
  decorators: [
    (Story) => (
      <BookmarkScope>
        <Story />
      </BookmarkScope>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Production-адаптер закладки. Состояния закладок спрашивает только вошедший читатель: " +
          "страница материала уже знает, есть ли аккаунт.",
      },
    },
  },
} satisfies Meta<typeof SavedBookmarkAction>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Гость: приглашение войти без единого запроса, поэтому в консоли нет отказа 401. */
export const Guest: Story = {
  args: { signedIn: false },
  beforeEach: recordedFetch(() => new Response(null, { status: 401 })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "В закладки" })).toHaveAttribute("href", "/account");
    await expect(requestedPaths).toEqual([]);
  },
};

/** Участник: тот же адаптер спрашивает состояние и показывает сохранённую закладку. */
export const Member: Story = {
  args: { signedIn: true },
  beforeEach: recordedFetch(() => Response.json({ kind: "ready", states: [bookmarkedState] })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole("button", { name: "В закладках" })).toHaveAttribute("aria-pressed", "true");
    });
    await expect(requestedPaths).toEqual(["/api/bookmarks/states"]);
  },
};
