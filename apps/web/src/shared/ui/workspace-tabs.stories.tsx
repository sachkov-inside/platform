import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { WorkspaceTabs } from "./workspace-tabs.client";

const meta = {
  title: "Shared/Workspace tasks",
  component: WorkspaceTabs,
  args: {
    label: "Задачи редактора",
    tabs: [
      {
        id: "draft",
        label: "Описание",
        panel: (
          <label>
            Название
            <input
              className="block min-h-11 border border-input bg-card px-3"
              defaultValue="Продукт"
            />
          </label>
        ),
      },
      {
        id: "program",
        label: "Программа",
        panel: <p>Материалы выбранного продукта</p>,
      },
      {
        id: "settings",
        label: "Настройки и дополнительные параметры",
        panel: <p>Параметры продукта</p>,
      },
    ],
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof WorkspaceTabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DraftSurvivesTaskSwitch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const original = canvas.getByLabelText("Название");
    await userEvent.clear(original);
    await userEvent.type(original, "Несохранённое название");
    await userEvent.click(canvas.getByRole("tab", { name: "Программа" }));
    await expect(original).not.toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "Описание" }));
    await expect(canvas.getByLabelText("Название")).toBe(original);
    await expect(original).toHaveValue("Несохранённое название");
    await userEvent.keyboard("{End}");
    await expect(
      canvas.getByRole("tab", { name: "Настройки и дополнительные параметры" }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("tab", { name: "Описание" })).toHaveFocus();
    await expect(original).toHaveValue("Несохранённое название");
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

const reportedSelection = fn();

/**
 * Выбор принадлежит странице (например, адресу `?tab=`): вкладки сообщают о нём, а показывают то,
 * что страница передала. Незнакомое значение показывает первую вкладку.
 */
function PageOwnedTabs(args: ComponentProps<typeof WorkspaceTabs>) {
  const [selectedId, setSelectedId] = useState("unknown");
  return (
    <>
      <p>Выбрано страницей: {selectedId}</p>
      <WorkspaceTabs
        {...args}
        onSelect={(id) => {
          reportedSelection(id);
          setSelectedId(id);
        }}
        selectedId={selectedId}
      />
    </>
  );
}

export const ControlledByPage: Story = {
  render: (args) => <PageOwnedTabs {...args} />,
  play: async ({ canvasElement }) => {
    reportedSelection.mockClear();
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tab", { name: "Описание" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const original = canvas.getByLabelText("Название");
    await userEvent.type(original, " с правкой");
    await userEvent.click(canvas.getByRole("tab", { name: "Программа" }));
    await expect(reportedSelection).toHaveBeenLastCalledWith("program");
    await expect(canvas.getByText("Выбрано страницей: program")).toBeVisible();
    await expect(original).not.toBeVisible();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(reportedSelection).toHaveBeenLastCalledWith("draft");
    await expect(canvas.getByRole("tab", { name: "Описание" })).toHaveFocus();
    await expect(original).toHaveValue("Продукт с правкой");
  },
};
