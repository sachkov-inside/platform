import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { formatCountRu } from "@/shared/lib/moscow-format";
import { internalRoute } from "@/shared/routing/internal-route";

import {
  captureRouterPush,
  materialActions,
  materialColumns,
  materialHref,
  materialMobileItem,
  storyMaterials,
  storyRouterPush,
  type StoryMaterialRow,
} from "./admin.fixtures";
import { AdminRowMenu } from "./admin-row-menu.client";
import { AdminTable, type AdminTableColumn } from "./admin-table.client";
import { StateBadge, type AdminStateKey } from "./state-badge";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const meta = {
  title: "Components/Админка/AdminTable",
  component: AdminTable<StoryMaterialRow>,
  parameters: { layout: "padded" },
  args: {
    caption: "Материалы",
    columns: materialColumns,
    rows: storyMaterials(6),
    rowKey: (row) => row.id,
    rowHref: materialHref,
    rowTitle: (row) => row.title,
    rowActions: materialActions,
    mobileItem: materialMobileItem,
  },
  beforeEach: captureRouterPush,
} satisfies Meta<typeof AdminTable<StoryMaterialRow>>;
export default meta;
type Story = StoryObj<typeof meta>;

async function expectNoHorizontalOverflow() {
  await waitFor(() =>
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    ),
  );
}

export const MaterialsDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole("table", { name: "Материалы" });
    await expect(canvas.queryByRole("list", { name: "Материалы" })).toBeNull();
    const headers = within(table).getAllByRole("columnheader");
    await expect(headers.map((header) => header.textContent)).toEqual([
      "Название",
      "Состояние",
      "Изменён",
      "Действия",
    ]);
    const firstRow = within(table).getAllByRole("row")[1];
    if (firstRow === undefined) throw new Error("Нет первой строки");
    const row = within(firstRow);
    await expect(
      row.getByRole("link", {
        name: "Как устроен контекст агента и почему он заканчивается раньше, чем кажется",
      }),
    ).toHaveAttribute("href", "/authoring/materials/material-1");

    await userEvent.click(row.getByText("24 окт. 2026, 14:05"));
    await expect(storyRouterPush).toHaveBeenCalledWith(
      "/authoring/materials/material-1",
    );

    storyRouterPush.mockClear();
    const menu = row.getByRole("button", {
      name: "Действия с «Как устроен контекст агента и почему он заканчивается раньше, чем кажется»",
    });
    await userEvent.click(menu);
    const body = within(document.body);
    const opened = await body.findByRole("menu");
    // The menu fades in: visibility is a fact only once its entry animation has finished.
    await Promise.all(
      opened
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
    await expect(
      within(opened).getByRole("menuitem", { name: "Снять с публикации" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveFocus());
    await expect(storyRouterPush).not.toHaveBeenCalled();
  },
};

export const MaterialsMobile: Story = {
  ...mobile,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("table")).toBeNull();
    const list = canvas.getByRole("list", { name: "Материалы" });
    const items = within(list).getAllByRole("listitem");
    await expect(items).toHaveLength(6);
    const first = items[0];
    if (first === undefined) throw new Error("Нет первой строки");
    await userEvent.click(within(first).getByText("AI Engineering · Гайд"));
    await expect(storyRouterPush).toHaveBeenCalledWith(
      "/authoring/materials/material-1",
    );
    const trigger = within(first).getByRole("button", {
      name: /^Действия с «Как устроен контекст/u,
    });
    const box = trigger.getBoundingClientRect();
    await expect(box.width).toBeGreaterThanOrEqual(44);
    await expect(box.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow();
  },
};

export const SingleRowDesktop: Story = {
  ...desktop,
  args: { rows: storyMaterials(1) },
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole("table", {
      name: "Материалы",
    });
    await expect(within(table).getAllByRole("row")).toHaveLength(2);
  },
};

export const SingleRowMobile: Story = {
  ...mobile,
  args: { rows: storyMaterials(1) },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole("list", {
      name: "Материалы",
    });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  },
};

export const LongListDesktop: Story = {
  ...desktop,
  args: { rows: storyMaterials(40) },
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole("table", {
      name: "Материалы",
    });
    const rows = within(table).getAllByRole("row").slice(1);
    await expect(rows).toHaveLength(40);
    for (const row of rows) {
      const height = row.getBoundingClientRect().height;
      await expect(height).toBeGreaterThanOrEqual(52);
      await expect(height).toBeLessThanOrEqual(80);
    }
    await expectNoHorizontalOverflow();
  },
};

export const LongListMobile: Story = {
  ...mobile,
  args: { rows: storyMaterials(40) },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole("list", {
      name: "Материалы",
    });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(40);
    await expectNoHorizontalOverflow();
  },
};

export const RefetchingDesktop: Story = {
  ...desktop,
  args: { busy: true },
  // Притушенные строки показывают устаревшие данные на доли секунды до ответа; их контраст намеренно ниже,
  // а готовые строки проверяют остальные истории.
  parameters: {
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  },
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole("table", {
      name: "Материалы",
    });
    await expect(table.parentElement).toHaveAttribute("aria-busy", "true");
  },
};

interface StoryProductRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly state: AdminStateKey;
  readonly holders: number;
  readonly materials: number;
}

const products: readonly StoryProductRow[] = [
  {
    id: "ai-engineering",
    name: "AI Engineering: разработка с агентами от задачи до релиза",
    kind: "Курс",
    state: "product.active",
    holders: 128,
    materials: 42,
  },
  {
    id: "prompt-pack",
    name: "Набор промптов",
    kind: "Руководство",
    state: "product.pinned",
    holders: 7,
    materials: 12,
  },
  {
    id: "legacy",
    name: "Прежний курс по архитектуре",
    kind: "Курс",
    state: "product.archived",
    holders: 1_204,
    materials: 0,
  },
];

const productColumns: readonly AdminTableColumn<StoryProductRow>[] = [
  { id: "name", header: "Название", cell: (row) => row.kind },
  {
    id: "state",
    header: "Состояние",
    width: "10rem",
    cell: (row) => <StateBadge state={row.state} />,
  },
  {
    id: "holders",
    header: "Обладатели",
    width: "8rem",
    align: "end",
    cell: (row) => row.holders.toLocaleString("ru-RU"),
  },
  {
    id: "materials",
    header: "Материалы",
    width: "8rem",
    align: "end",
    cell: (row) => row.materials.toLocaleString("ru-RU"),
  },
];

/** Числа выровнены вправо табличными цифрами; одно прямое действие рядом с «⋯». */
export const NumbersAndDirectActionDesktop: StoryObj<
  typeof AdminTable<StoryProductRow>
> = {
  ...desktop,
  args: {
    caption: "Продукты",
    columns: productColumns,
    rows: products,
    rowKey: (row) => row.id,
    rowHref: (row) => internalRoute(`/authoring/products/${row.id}`),
    rowTitle: (row) => row.name,
    actionsWidth: "9.5rem",
    rowActions: (row) => (
      <>
        <a
          className="admin-text-button inline-flex items-center"
          data-row-action=""
          href={`/products/${row.id}`}
        >
          На сайте
        </a>
        <AdminRowMenu
          items={[{ id: "archive", label: "В архив", tone: "danger" }]}
          label={`Действия с «${row.name}»`}
        />
      </>
    ),
    mobileItem: (row) => ({
      title: row.name,
      caption: row.kind,
      badge: <StateBadge state={row.state} />,
      metric: formatCountRu(row.holders, [
        "обладатель",
        "обладателя",
        "обладателей",
      ]),
    }),
  },
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole("table", {
      name: "Продукты",
    });
    const holders = within(table).getByRole("columnheader", {
      name: "Обладатели",
    });
    await expect(getComputedStyle(holders).textAlign).toBe("end");
    const cell = within(table).getByText("1 204");
    await expect(getComputedStyle(cell).fontVariantNumeric).toBe(
      "tabular-nums",
    );
  },
};

export const NumbersAndDirectActionMobile: StoryObj<
  typeof AdminTable<StoryProductRow>
> = {
  ...NumbersAndDirectActionDesktop,
  ...mobile,
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole("list", { name: "Продукты" });
    await expect(within(list).getByText("1 204 обладателя")).toBeVisible();
    await expectNoHorizontalOverflow();
  },
};
