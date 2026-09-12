import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { expect, fn, waitFor, within } from "storybook/test";

import { MaterialReadingContext } from "@/entities/material";
import { fetchBeforeRender } from "@/workshop/mutation-mock";

import { SavedBookmarkAction } from "./saved-bookmark-action.client";

const materialId = "10000000-0000-4000-8000-000000000542";
const accountId = "20000000-0000-4000-8000-000000000542";
const bookmarkedState = {
  bookmarked: true,
  bookmarkedAt: "2026-09-12T00:00:00.000Z",
  materialId,
};

/** Личные запросы страницы за прогон story; Storybook сбрасывает шпиона перед каждой. */
const requestPath = fn();

function recordedFetch(respond: () => Response) {
  return fetchBeforeRender((input) => {
    const target = input instanceof Request ? input.url : String(input);
    requestPath(new URL(target, window.location.origin).pathname);
    return Promise.resolve(respond());
  });
}

/**
 * Тот же шов, что на маршруте: оболочка разрешает аккаунт посетителя один раз и публикует его
 * в этом контексте. Своё хранилище запросов — чтобы ответы не переносились между story.
 */
function BookmarkScope({ accountId: account, children }: { readonly accountId: string | null; readonly children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <MaterialReadingContext
        value={{
          accountId: account,
          resolved: true,
          states: new Map(),
          failed: false,
          register: () => () => undefined,
          refresh: () => Promise.resolve(),
        }}
      >
        <div className="flex min-h-40 items-start justify-end p-8">{children}</div>
      </MaterialReadingContext>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Features/Bookmarks adapter",
  component: SavedBookmarkAction,
  args: { materialId },
  parameters: {
    docs: {
      description: {
        component:
          "Production-адаптер закладки на странице материала. Состояния закладок спрашивает " +
          "только вошедший читатель: аккаунт посетителя уже разрешён оболочкой.",
      },
    },
  },
} satisfies Meta<typeof SavedBookmarkAction>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Гость: приглашение войти без единого личного запроса, поэтому в консоли нет отказа 401. */
export const Guest: Story = {
  beforeEach: recordedFetch(() => new Response(null, { status: 401 })),
  decorators: [(Story) => <BookmarkScope accountId={null}><Story /></BookmarkScope>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "В закладки" })).toHaveAttribute("href", "/account");
    await expect(requestPath).not.toHaveBeenCalled();
  },
};

/** Участник: тот же адаптер спрашивает состояние и показывает сохранённую закладку. */
export const Member: Story = {
  beforeEach: recordedFetch(() => Response.json({ kind: "ready", states: [bookmarkedState] })),
  decorators: [(Story) => <BookmarkScope accountId={accountId}><Story /></BookmarkScope>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole("button", { name: "В закладках" })).toHaveAttribute("aria-pressed", "true");
    });
    await expect(requestPath).toHaveBeenCalledWith("/api/bookmarks/states");
  },
};
