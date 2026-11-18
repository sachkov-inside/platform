import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  createLibraryCatalogQueryOptions,
  type LibraryCatalogPage,
  type LibrarySearchQuery,
} from "@/features/library-catalog";
import { getQueryClient } from "@/shared/api/query-client";
import { illustratedHome } from "@/storybook/home.fixtures";
import { learningProgramme } from "@/storybook/learning.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { HomeFeedView } from "./home-feed.client";
import { HomePage } from "./home-page";

const query: LibrarySearchQuery = {
  after: null,
  q: "",
  sort: "newest",
  formatSlugs: [],
  topicSlug: null,
};
function sampleMaterials() {
  const materials = learningProgramme("holder").items;
  const first = materials[0];
  const last = materials[1];
  if (first === undefined || last === undefined)
    throw new Error("Two synthetic Materials required");
  return [first, last] as const;
}
const materials = sampleMaterials();
const [first, last] = materials;

function page(
  items: readonly (typeof first)[],
  nextCursor: string | null,
): LibraryCatalogPage {
  return {
    kind: "ready",
    items,
    nextCursor,
    totalCount: 2,
    facets: { formats: [], topics: [], products: [] },
  };
}

class ContinuationPages {
  readonly cursors: (string | undefined)[] = [];
  recovered = false;
  private finish: (() => void) | undefined;
  readonly read: Parameters<typeof createLibraryCatalogQueryOptions>[0] = ({
    after,
    signal,
  }) => {
    this.cursors.push(after);
    if (after === undefined) return Promise.resolve(page([first], "next"));
    if (after === "next") {
      if (!this.recovered)
        return Promise.reject(new Error("Synthetic unavailable page"));
      return Promise.resolve(page([], "last"));
    }
    if (after !== "last") throw new Error(`Unexpected cursor ${after}`);
    return new Promise((resolve, reject) => {
      const abort = () => {
        reject(
          new DOMException("Synthetic continuation cancelled", "AbortError"),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      this.finish = () => {
        signal.removeEventListener("abort", abort);
        resolve(page([last], null));
        this.finish = undefined;
      };
    });
  };
  deliverLast() {
    if (this.finish === undefined)
      throw new Error("Final read has not started");
    this.finish();
  }
}

function pagesFrom(loaded: Record<string, unknown>): ContinuationPages {
  const pages = loaded["pages"];
  if (!(pages instanceof ContinuationPages))
    throw new Error("Missing page sequence");
  return pages;
}

const environment = publicPageEnvironment("/");
const meta = {
  ...environment,
  title: "Pages/Home continuation",
  component: HomePage,
  args: {
    result: {
      kind: "ready",
      value: { ...illustratedHome, pinnedProduct: null },
    },
  },
  beforeEach: () => {
    environment.beforeEach();
    getQueryClient().clear();
    return () => {
      getQueryClient().clear();
    };
  },
} satisfies Meta<typeof HomePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FailedThenEmptyPagePreservesContinuation: Story = {
  loaders: [() => ({ pages: new ContinuationPages() })],
  render: (args, { loaded }) => {
    const pages = pagesFrom(loaded);
    return (
      <HomePage
        {...args}
        feed={
          <HomeFeedView
            initialQuery={query}
            createQueryOptions={(state) =>
              createLibraryCatalogQueryOptions(pages.read, state)
            }
          />
        }
      />
    );
  },
  play: async ({ canvasElement, loaded }) => {
    const pages = pagesFrom(loaded);
    const canvas = within(canvasElement);
    const feed = within(
      await canvas.findByRole("region", { name: "Материалы" }),
    );
    await feed.findByRole("heading", { name: first.title });
    // The public QueryClient retains its real retry policy; this is a required reader port,
    // as in home-page.stories.tsx, not a replacement for the existing BFF or browser adapter.
    await waitFor(
      () =>
        expect(
          feed.getByText("Не удалось загрузить продолжение каталога."),
        ).toBeVisible(),
      { timeout: 12_000 },
    );
    await expect(
      feed.getByRole("heading", { name: first.title }),
    ).toBeVisible();
    await expect(feed.queryByText("Все материалы загружены")).toBeNull();
    pages.recovered = true;
    await userEvent.click(feed.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(pages.cursors.at(-1)).toBe("last"));
    await feed.findByText("Загружаем ещё материалы…");
    await expect(
      feed.getByRole("list", { name: "Материалы, страница 2" }),
    ).toBeEmptyDOMElement();
    await expect(
      feed.getByRole("heading", { name: first.title }),
    ).toBeVisible();
    pages.deliverLast();
    await feed.findByRole("heading", { name: last.title });
    await feed.findByText("Все материалы загружены");
    await expect(
      feed.queryByRole("button", { name: "Показать ещё" }),
    ).toBeNull();
    await expect(pages.cursors[0]).toBeUndefined();
    await expect(
      pages.cursors.filter((cursor) => cursor === "last"),
    ).toHaveLength(1);
  },
};
