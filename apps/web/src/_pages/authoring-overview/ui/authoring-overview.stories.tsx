import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { OverviewReport } from "@/_pages/authoring-overview/model/overview-report";
import { AuthoringOverviewLoading } from "@/_pages/authoring-overview/ui/authoring-overview-loading";
import { AuthoringOverviewPage } from "@/_pages/authoring-overview/ui/authoring-overview-page";
import { AuthoringOverviewView } from "@/_pages/authoring-overview/ui/authoring-overview-view.client";
import { getQueryClient } from "@/shared/api/query-client";
import { authoringOverviewHref } from "@/shared/routing/authoring";
import {
  storyOverviewAllClear,
  storyOverviewEmpty,
  storyOverviewLongLists,
  storyOverviewMaterialsOnly,
  storyOverviewOneSale,
  storyOverviewReport,
  storyOverviewUnavailable,
} from "@/storybook/admin-overview.fixtures";
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
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

function ready(report: OverviewReport) {
  return { kind: "ready" as const, ...report };
}

const queryChanged = fn();
const retried = fn();
const environment = authoringPageEnvironment(authoringOverviewHref);

const meta = {
  ...environment,
  args: {
    onQueryChange: queryChanged,
    onRetry: retried,
    query: { period: 30, metric: "revenue" },
    state: ready(storyOverviewReport()),
  },
  beforeEach: () => {
    queryChanged.mockClear();
    retried.mockClear();
    return environment.beforeEach();
  },
  component: AuthoringOverviewView,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Обзор админки (#1719): показатели за период со сравнением, график выбранного показателя, «Требует внимания», последние события, краткая воронка и обучение по продуктам. Период и показатель графика живут в адресе; страница читает Обзор через browser-owned TanStack Query, Storybook передаёт состояние напрямую.",
      },
    },
  },
  title: "Pages/Authoring/Обзор",
} satisfies Meta<typeof AuthoringOverviewView>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  await waitFor(() => expect(root.scrollWidth).toBe(root.clientWidth));
}

export const Owner: Story = {
  globals: desktop.globals,
  name: "Владелец · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Обзор" }),
    ).toBeVisible();
    const metrics = within(page.getByRole("region", { name: "Показатели" }));
    const revenue = metrics.getByRole("button", {
      name: /^Выручка за вычетом возвратов/u,
    });
    await expect(revenue).toHaveAttribute("aria-pressed", "true");
    await expect(
      metrics.getByRole("button", { name: /^Новые доступы/u }),
    ).toHaveTextContent(/Покупка: \d+/u);
    await userEvent.click(metrics.getByRole("button", { name: /^Продажи/u }));
    await expect(queryChanged).toHaveBeenCalledWith({
      period: 30,
      metric: "sales",
    });
    const sevenDays = page.getByRole("button", { name: "7 дней" });
    await userEvent.click(sevenDays);
    // Story держит период в args: фокус уходит, чтобы снимок не показывал рамку фокуса.
    sevenDays.blur();
    await expect(queryChanged).toHaveBeenLastCalledWith({
      period: 7,
      metric: "revenue",
    });
    const attention = within(
      page.getByRole("region", { name: "Требует внимания" }),
    );
    await expect(
      attention.getByRole("link", {
        name: "Оплаты с неизвестным итогом: 2 оплаты",
      }),
    ).toHaveAttribute(
      "href",
      "/authoring/sales/payments?state=unknown&state=authorized",
    );
    await expect(
      page.getByRole("link", { name: "Полный отчёт" }),
    ).toHaveAttribute(
      "href",
      "/authoring/sales/funnel?productId=97000000-0000-4000-8000-000000000301",
    );
    await expect(page.queryByText(/@example/u)).toBeNull();
  },
};

export const OwnerMobile: Story = {
  globals: mobile.globals,
  name: "Владелец · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("list", { name: "Обучение по продуктам" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const SalesChart: Story = {
  args: { query: { period: 30, metric: "sales" } },
  globals: desktop.globals,
  name: "График продаж",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("region", { name: "График: Продажи" }),
    ).toHaveTextContent("За 30 дней: 17 продаж.");
  },
};

export const EmptyPeriod: Story = {
  args: { state: ready(storyOverviewEmpty()) },
  globals: desktop.globals,
  name: "Пустой период",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByText("За период нет оплат")).toBeVisible();
    await expect(page.getAllByText("нет данных").length).toBeGreaterThan(0);
    await expect(page.getByText("Всё в порядке")).toBeVisible();
    await expect(page.getByText("Событий пока нет")).toBeVisible();
    await expect(page.getByText("Воронки пока нет")).toBeVisible();
  },
};

export const EmptyPeriodMobile: Story = {
  ...EmptyPeriod,
  globals: mobile.globals,
  name: "Пустой период · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const OneSale: Story = {
  args: {
    query: { period: 7, metric: "sales" },
    state: ready(storyOverviewOneSale()),
  },
  globals: desktop.globals,
  name: "Одна продажа за неделю",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const sales = page.getByRole("button", { name: /^Продажи/u });
    await expect(sales).toHaveTextContent("1");
    // В прошлом периоде продаж не было: сравнения нет.
    await expect(sales).toHaveTextContent("нет данных");
    await expect(
      page.getByRole("button", { name: /^Новые аккаунты/u }),
    ).toHaveTextContent("+1 аккаунт");
    await expect(
      page.getByRole("button", { name: /^Записи в списки ожидания/u }),
    ).toHaveTextContent("−1 запись");
  },
};

export const OneSaleMobile: Story = {
  ...OneSale,
  globals: mobile.globals,
  name: "Одна продажа · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const LongLists: Story = {
  args: {
    query: { period: 90, metric: "newAccess" },
    state: ready(storyOverviewLongLists()),
  },
  globals: desktop.globals,
  name: "Длинная лента и много продуктов",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      within(
        page.getByRole("list", { name: "Последние события" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(10);
    await expect(
      within(
        page.getByRole("table", { name: "Обучение по продуктам" }),
      ).getAllByRole("row"),
    ).toHaveLength(15);
  },
};

export const LongListsMobile: Story = {
  ...LongLists,
  globals: mobile.globals,
  name: "Длинные списки · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const MaterialsOnly: Story = {
  args: { state: ready(storyOverviewMaterialsOnly()) },
  globals: desktop.globals,
  name: "Автор только материалов",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.queryByRole("region", { name: "Показатели" })).toBeNull();
    await expect(page.queryByRole("group", { name: "Период" })).toBeNull();
    await expect(page.queryByRole("region", { name: "Обучение" })).toBeNull();
    await expect(
      page.getByRole("region", { name: "Продажи и доступы" }),
    ).toHaveTextContent("право управлять доступом и оплатами");
    await expect(
      page.getByRole("link", { name: "Сдачи без комментария: 4 сдачи" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Оплаты, выдачу и Telegram проверяет аккаунт с правом управлять доступом и оплатами.",
      ),
    ).toBeVisible();
    // Карточка человека автору без права не предлагается.
    await expect(
      within(page.getByRole("list", { name: "Последние события" })).queryByRole(
        "link",
        { name: "Анна Петрова" },
      ),
    ).toBeNull();
  },
};

export const MaterialsOnlyMobile: Story = {
  ...MaterialsOnly,
  globals: mobile.globals,
  name: "Автор только материалов · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Unavailable: Story = {
  args: { state: ready(storyOverviewUnavailable()) },
  globals: desktop.globals,
  name: "Источники не ответили",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("button", { name: /^Выручка за вычетом возвратов/u }),
    ).toHaveTextContent("Недоступно");
    await expect(page.getByText("График недоступен")).toBeVisible();
    await expect(
      page.getByText("Не удалось проверить оплаты с неизвестным итогом"),
    ).toBeVisible();
    await expect(page.queryByText("Всё в порядке")).toBeNull();
    await expect(page.getByText("Лента может быть неполной")).toBeVisible();
    await expect(page.getByText("Воронка не загрузилась")).toBeVisible();
    await expect(page.getByText("Обучение не загрузилось")).toBeVisible();
  },
};

export const UnavailableMobile: Story = {
  ...Unavailable,
  globals: mobile.globals,
  name: "Источники не ответили · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const AllClear: Story = {
  args: { state: ready(storyOverviewAllClear()) },
  globals: desktop.globals,
  name: "Всё в порядке",
  play: async ({ canvasElement }) => {
    const attention = within(
      routeContent(canvasElement).getByRole("region", {
        name: "Требует внимания",
      }),
    );
    await expect(attention.getByRole("status")).toHaveTextContent(
      "Всё в порядке",
    );
    await expect(attention.queryByRole("link")).toBeNull();
  },
};

export const AllClearMobile: Story = {
  ...AllClear,
  globals: mobile.globals,
  name: "Всё в порядке · телефон",
};

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Нет доступа к Обзору",
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Нет доступа к Обзору",
      }),
    ).toBeVisible();
  },
};

export const Failed: Story = {
  args: { state: { kind: "unavailable", reference: "overview-503" } },
  globals: mobile.globals,
  name: "Сбой чтения · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(page.getByRole("button", { name: "Повторить" }));
    await expect(retried).toHaveBeenCalledOnce();
  },
};

export const Loading: Story = {
  globals: desktop.globals,
  name: "Загрузка",
  render: () => <AuthoringOverviewLoading />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("main", { name: "Загрузка обзора" }),
    ).toHaveAttribute("aria-busy", "true");
  },
};

export const LoadingMobile: Story = {
  ...Loading,
  globals: mobile.globals,
  name: "Загрузка · телефон",
};

let deliverOverview: () => void = () => undefined;

function heldOverviewFetch(): MutationFetch {
  const delivered = new Promise<void>((resolve) => {
    deliverOverview = resolve;
  });
  return async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (url.pathname === "/api/authoring/overview") {
      await delivered;
      return Response.json(ready(storyOverviewReport()));
    }
    return new Response(null, { status: 404 });
  };
}

/** Скелет стоит в геометрии Обзора: ни заголовок, ни ряд показателей не сдвигаются. */
function loadsInPlace({ globals, width }: StoryViewport): Story {
  return {
    beforeEach: () => {
      const restoreEnvironment = environment.beforeEach();
      getQueryClient().removeQueries({ queryKey: ["authoring"] });
      const restoreFetch = fetchBeforeRender(heldOverviewFetch())();
      return () => {
        restoreFetch();
        restoreEnvironment?.();
      };
    },
    globals,
    name: `Загрузка на месте · ${String(width)}`,
    play: async ({ canvasElement }) => {
      await settleStoryFrame(width);
      const measure = () => ({
        title: originOf(
          boxOf(
            canvasElement,
            "[data-authoring-overview] .admin-list-header h1",
          ),
        ),
        metrics: originOf(
          boxOf(
            canvasElement,
            "[data-authoring-overview] .admin-overview-metrics",
          ),
        ),
      });
      const skeleton = measure();
      deliverOverview();
      await expect(
        await within(canvasElement).findByRole("region", {
          name: "Показатели",
        }),
      ).toBeVisible();
      await expect(measure()).toEqual(skeleton);
    },
    render: () => <AuthoringOverviewPage />,
  };
}

export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
