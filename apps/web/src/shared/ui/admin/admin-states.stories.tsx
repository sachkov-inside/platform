import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";

import { internalRoute } from "@/shared/routing/internal-route";
import { Button } from "@/shared/ui/button";

import {
  materialColumns,
  materialHref,
  materialMobileItem,
  storyMaterials,
} from "./admin.fixtures";
import {
  AdminEmptyState,
  AdminErrorState,
  AdminNoResults,
  AdminNotFound,
  AdminTableSkeleton,
} from "./admin-states";
import { AdminTable } from "./admin-table.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const reset = fn();
const retry = fn();

const meta = {
  title: "Components/Админка/AdminStates",
  component: AdminEmptyState,
  parameters: { layout: "padded" },
  args: {
    title: "Материалов пока нет",
    description:
      "Создайте первый материал: гайд, видео или заметку. Он останется черновиком, пока вы его не опубликуете.",
    action: (
      <Button className="min-h-11 px-4" type="button">
        <Plus aria-hidden="true" />
        Создать материал
      </Button>
    ),
  },
  beforeEach: () => {
    reset.mockClear();
    retry.mockClear();
  },
} satisfies Meta<typeof AdminEmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstUseDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 2, name: "Материалов пока нет" }),
    ).toBeVisible();
    await expect(canvas.queryByRole("table")).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Создать материал" }),
    ).toBeVisible();
  },
};

export const FirstUseMobile: Story = { ...FirstUseDesktop, ...mobile };

export const NoResultsDesktop: Story = {
  ...desktop,
  render: () => (
    <AdminNoResults
      description="По запросу «агент» среди гайдов темы «Архитектура» материалов нет."
      onReset={reset}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Ничего не найдено" }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(reset).toHaveBeenCalledTimes(1);
  },
};

export const NoResultsMobile: Story = { ...NoResultsDesktop, ...mobile };

export const ErrorDesktop: Story = {
  ...desktop,
  render: () => (
    <AdminErrorState
      description="Сервер не ответил вовремя. Данные не изменились; попробуйте ещё раз через минуту."
      onRetry={retry}
      reference="req_7f3a91c2e4b54d0c"
      title="Не удалось загрузить материалы"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveTextContent(
      "Код обращения: req_7f3a91c2e4b54d0c",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await expect(retry).toHaveBeenCalledTimes(1);
  },
};

export const ErrorMobile: Story = { ...ErrorDesktop, ...mobile };

export const NotFoundDesktop: Story = {
  ...desktop,
  render: () => (
    <AdminNotFound
      backHref={internalRoute("/authoring/topics")}
      backLabel="Вернуться к темам"
      description="Тема перенесена в архив и удалена, или ссылка неполная. Найдите её в списке тем."
      title="Тема не найдена"
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("link", {
        name: "Вернуться к темам",
      }),
    ).toHaveAttribute("href", "/authoring/topics");
  },
};

export const NotFoundMobile: Story = { ...NotFoundDesktop, ...mobile };

const readyRows = storyMaterials(5).filter((row) =>
  ["material-2", "material-5"].includes(row.id),
);

/**
 * Скелет и готовая таблица в одной геометрии: заголовок и строки той же высоты, поэтому приход
 * данных не сдвигает ни таблицу, ни то, что под ней.
 */
function SkeletonAndReady() {
  return (
    <div className="grid gap-10">
      <div data-geometry="skeleton">
        <AdminTableSkeleton columns={4} rows={readyRows.length} />
      </div>
      <div data-geometry="ready">
        <AdminTable
          caption="Материалы"
          columns={materialColumns}
          mobileItem={materialMobileItem}
          rowActions={() => (
            <button
              aria-label="Действия"
              className="admin-row-menu-trigger"
              type="button"
            />
          )}
          rowHref={materialHref}
          rowKey={(row) => row.id}
          rowTitle={(row) => row.title}
          rows={readyRows}
        />
      </div>
    </div>
  );
}

async function expectSameGeometry(canvasElement: HTMLElement) {
  const height = (name: string) =>
    canvasElement
      .querySelector(`[data-geometry="${name}"]`)
      ?.getBoundingClientRect().height;
  await document.fonts.ready;
  await expect(height("skeleton")).toBeGreaterThan(0);
  await expect(
    Math.abs((height("skeleton") ?? 0) - (height("ready") ?? 0)),
  ).toBeLessThanOrEqual(1);
}

export const SkeletonDesktop: Story = {
  ...desktop,
  render: () => <SkeletonAndReady />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      "Загружаем список",
    );
    await expectSameGeometry(canvasElement);
  },
};

export const SkeletonMobile: Story = {
  ...mobile,
  render: () => <SkeletonAndReady />,
  play: async ({ canvasElement }) => {
    await expectSameGeometry(canvasElement);
  },
};
