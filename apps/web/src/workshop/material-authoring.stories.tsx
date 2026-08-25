import type { JSONContent } from "@tiptap/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  MaterialAuthoringWorkspace,
  type MaterialAuthoringActions,
  type MaterialAuthoringPresentation,
  type MaterialDraftField,
} from "@/features/material-authoring";

import {
  emptyMaterialAuthoringPresentation,
  materialAuthoringPresentation,
  savedAfterEditingPresentation,
  savedRevisionId,
} from "./material-authoring.fixtures";

const noopActions = {
  onBack: fn(),
  onConflictAction: fn(),
  onDocumentChange: fn(),
  onFieldChange: fn(),
  onOpenPreview: fn(),
  onRetry: fn(),
  onReturnToEditor: fn(),
  onSave: fn(),
} satisfies MaterialAuthoringActions;

function MaterialAuthoringFixture({
  initialPresentation,
}: {
  readonly initialPresentation: MaterialAuthoringPresentation;
}) {
  const [presentation, setPresentation] = useState(initialPresentation);

  const markDirty = (draft: MaterialAuthoringPresentation["draft"]) => {
    setPresentation((current) => ({
      ...current,
      draft,
      save: { kind: "dirty" },
    }));
  };

  const actions = {
    onBack: noopActions.onBack,
    onConflictAction: (action) => {
      noopActions.onConflictAction(action);
      if (action === "reload") {
        setPresentation((current) => ({
          ...current,
          blocking: { kind: "none" },
          save: { kind: "saved", savedAtLabel: "12:41" },
        }));
      }
    },
    onDocumentChange: (document: JSONContent) => {
      noopActions.onDocumentChange(document);
      markDirty({ ...presentation.draft, document });
    },
    onFieldChange: (field: MaterialDraftField, value: string) => {
      noopActions.onFieldChange(field, value);
      if (field === "access") {
        markDirty({
          ...presentation.draft,
          access: value === "membership" ? "membership" : "free",
        });
        return;
      }
      markDirty({ ...presentation.draft, [field]: value });
    },
    onOpenPreview: () => {
      noopActions.onOpenPreview();
      setPresentation((current) => ({ ...current, mode: "preview" }));
    },
    onRetry: () => {
      noopActions.onRetry();
      setPresentation((current) => ({
        ...current,
        blocking: { kind: "none" },
        save: { kind: "dirty" },
      }));
    },
    onReturnToEditor: () => {
      noopActions.onReturnToEditor();
      setPresentation((current) => ({ ...current, mode: "editor" }));
    },
    onSave: () => {
      noopActions.onSave();
      setPresentation(savedAfterEditingPresentation);
    },
  } satisfies MaterialAuthoringActions;

  return <MaterialAuthoringWorkspace actions={actions} presentation={presentation} />;
}

const meta = {
  args: {
    actions: noopActions,
    presentation: materialAuthoringPresentation,
  },
  component: MaterialAuthoringWorkspace,
  parameters: {
    controls: {
      exclude: ["actions"],
    },
    docs: {
      description: {
        component:
          "Production-owned single-author Editor/exact Preview composition. Stories provide only serializable presentation fixtures; transport, authorization and persistence remain outside the UI module.",
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  render: ({ presentation }) => (
    <MaterialAuthoringFixture initialPresentation={presentation} />
  ),
  title: "Pages/Authoring/Editor and exact Preview",
} satisfies Meta<typeof MaterialAuthoringWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptyNewDraft: Story = {
  args: { presentation: emptyMaterialAuthoringPresentation },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  name: "Empty new draft · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Новый материал" })).toBeInTheDocument();
    await expect(canvas.getByLabelText("Название")).toHaveValue("");
    await expect(canvas.getByRole("button", { name: "Preview" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = canvas.getByLabelText("Название");
    await userEvent.clear(title);
    await userEvent.type(title, "Новая редакция Developer Pipeline");
    await userEvent.click(canvas.getByLabelText("Тема"));
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole("option", { name: "Архитектура" }));
    await waitFor(async () => {
      await expect(canvasElement).not.toHaveAttribute("aria-hidden");
    });
    await expect(canvas.getByLabelText("Тема")).toHaveTextContent("Архитектура");
    await expect(canvas.getAllByText("Есть несохранённые изменения", { exact: true }).length).toBeGreaterThan(0);
    await expect(canvas.getByRole("button", { name: "Preview" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(canvas.getAllByText(savedRevisionId).length).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    await expect(canvas.getByRole("heading", { name: "Новая редакция Developer Pipeline" })).toBeInTheDocument();
    await expect(canvas.getByText("Архитектура", { exact: true })).toBeInTheDocument();
    await expect(canvas.getAllByText(new RegExp(savedRevisionId)).length).toBeGreaterThan(0);
  },
};

export const Dirty: Story = {
  args: {
    presentation: { ...materialAuthoringPresentation, save: { kind: "dirty" } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Есть несохранённые изменения", { exact: true }).length).toBeGreaterThan(0);
    await expect(canvas.getByRole("button", { name: "Сохранить" })).toBeEnabled();
  },
};

export const Submitting: Story = {
  args: {
    presentation: { ...materialAuthoringPresentation, save: { kind: "submitting" } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const saveButton = canvas.getByRole("button", { name: "Сохранение…" });
    await expect(saveButton).toBeDisabled();
    await expect(canvas.getAllByText("Сохранение…").length).toBeGreaterThan(0);
    const loader = saveButton.querySelector("svg");
    await expect(loader).not.toBeNull();
    if (loader !== null) {
      const style = canvasElement.ownerDocument.defaultView?.getComputedStyle(loader);
      await expect(style?.animationName).toBe("none");
      await expect(style?.animationDuration).toBe("0s");
    }
  },
};

export const Saved: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      save: { kind: "saved", savedAtLabel: "12:41" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Сохранено 12:41", { exact: true }).length).toBeGreaterThan(0);
    await expect(canvas.getByRole("button", { name: "Preview" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Вернуться к материалам" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Preview" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByLabelText("Название")).toHaveFocus();
  },
};

export const Unauthorized: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      authorization: { kind: "unauthorized" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Нет доступа к редактору" })).toBeInTheDocument();
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

export const ExactPreview: Story = {
  args: {
    presentation: { ...materialAuthoringPresentation, mode: "preview" },
  },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Exact Preview · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Preview exact revision" })).toBeInTheDocument();
    await expect(canvas.getAllByText(/rev_01JY7A2M4N8QF3T6V9XC/).length).toBeGreaterThan(0);
    await expect(canvasElement.querySelector("[data-preview-revision-banner]")).toHaveTextContent(
      "Preview не меняет опубликованную редакцию.",
    );
    await expect(canvas.getByRole("heading", { name: "Developer Pipeline без магии" })).toBeInTheDocument();
  },
};

export const ExactPreviewMobile: Story = {
  args: {
    presentation: { ...materialAuthoringPresentation, mode: "preview" },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Exact Preview · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Preview exact revision" })).toBeInTheDocument();
    await expect(canvas.getAllByText(/rev_01JY7A2M4N8QF3T6V9XC/).length).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Conflict: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      blocking: {
        currentRevisionId: "rev_01JY7B5QD2K0T8WM4VCE",
        kind: "conflict",
        staleRevisionId: "rev_01JY7A2M4N8QF3T6V9XC",
      },
      save: { kind: "dirty" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Ничего не перезаписано");
    await expect(canvas.getByRole("button", { name: "Сравнить" })).toBeEnabled();
    await expect(canvas.getByLabelText("Название")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Полужирный" })).toBeDisabled();
  },
};

export const InfrastructureError: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      blocking: { correlationId: "req_8F3K2M", kind: "infrastructure_error" },
      save: { kind: "dirty" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Изменения остаются в редакторе");
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const MobileTextZoom: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      save: { kind: "saved", savedAtLabel: "12:41" },
    },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Mobile · 200% text zoom",
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectNoHorizontalOverflow(canvasElement);
      await expect(within(canvasElement).getByRole("button", { name: "Сохранить" })).toBeVisible();
    } finally {
      root.style.fontSize = previousFontSize;
    }
  },
};

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const storyWindow = canvasElement.ownerDocument.defaultView;
  if (storyWindow === null) {
    throw new Error("Story window is unavailable");
  }
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
    storyWindow.innerWidth + 1,
  );
}
