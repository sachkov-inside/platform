import type { JSONContent } from "@tiptap/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  MaterialAuthoringPreviewUnauthorizedState,
  MaterialAuthoringPreviewNotFoundState,
  MaterialAuthoringUnexpectedEditorState,
  MaterialAuthoringUnexpectedPreviewState,
  MaterialAuthoringWorkspace,
  type MaterialAuthoringActions,
  type MaterialAuthoringPresentation,
  type MaterialDraftField,
} from "@/features/material-authoring";

import {
  emptyMaterialAuthoringPresentation,
  materialAuthoringPresentation,
  savedAfterEditingPresentation,
  savedContentVersion,
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
  onSeriesMembershipChange: fn(),
  onTagToggle: fn(),
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
    onSeriesMembershipChange: (seriesId, ordinal) => {
      noopActions.onSeriesMembershipChange(seriesId, ordinal);
      markDirty({
        ...presentation.draft,
        seriesMemberships:
          ordinal === null
            ? presentation.draft.seriesMemberships.filter(
                (membership) => membership.seriesId !== seriesId,
              )
            : [
                ...presentation.draft.seriesMemberships.filter(
                  (membership) => membership.seriesId !== seriesId,
                ),
                { ordinal, seriesId },
              ],
      });
    },
    onTagToggle: (tagId: string, checked: boolean) => {
      noopActions.onTagToggle(tagId, checked);
      markDirty({
        ...presentation.draft,
        tagIds: checked
          ? [...presentation.draft.tagIds, tagId]
          : presentation.draft.tagIds.filter((candidate) => candidate !== tagId),
      });
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
    await expect(canvas.getByRole("button", { name: "Создать черновик" })).toBeDisabled();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = canvas.getByLabelText("Название");
    await userEvent.clear(title);
    await userEvent.type(title, "Новая версия Developer Pipeline");
    await expect(canvas.getAllByText("Есть несохранённые изменения", { exact: true }).length).toBeGreaterThan(0);
    await expect(canvas.getByRole("button", { name: "Preview" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(canvas.getAllByText(`v${String(savedContentVersion)}`).length).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    await expect(canvas.getByRole("heading", { name: "Новая версия Developer Pipeline" })).toBeInTheDocument();
    await expect(canvas.getAllByText(new RegExp(`v${String(savedContentVersion)}`)).length).toBeGreaterThan(0);
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
    await expect(canvas.getByRole("link", { name: "Перейти к содержанию" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: /Inside Authoring/ })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Материалы" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Новый материал" })).toHaveFocus();
  },
};

export const CreatedDraft: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      draft: {
        ...materialAuthoringPresentation.draft,
        formatId: "unassigned",
        readOnly: true,
        tagIds: [],
        topicId: "unassigned",
      },
      preview: {
        ...materialAuthoringPresentation.preview,
        format: "Формат не назначен",
        tags: [],
        topic: "Тема не назначена",
      },
      save: { kind: "saved", savedAtLabel: "сейчас" },
      validation: {
        issues: [
          { message: "Назначьте формат перед публикацией.", path: "/metadata/formatId" },
          { message: "Назначьте тему перед публикацией.", path: "/metadata/topicId" },
        ],
        kind: "invalid",
        scope: "publication",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Material сохранён")).toBeVisible();
    await expect(canvas.getByLabelText("Название")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Preview" })).toBeEnabled();
  },
};

export const ValidationPassed: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      save: { kind: "saved", savedAtLabel: "12:41" },
      validation: { headingCount: 2, kind: "valid", plainTextLength: 286 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Material сохранён")).toBeVisible();
    await expect(canvas.queryByText(/2 заголовков/)).not.toBeInTheDocument();
  },
};

export const ValidationIssues: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      draft: {
        ...materialAuthoringPresentation.draft,
        formatId: "unassigned",
        tagIds: [],
        topicId: "unassigned",
      },
      save: { kind: "saved", savedAtLabel: "12:41" },
      validation: {
        issues: [
          { message: "Назначьте формат перед публикацией.", path: "/metadata/formatId" },
          { message: "Назначьте тему перед публикацией.", path: "/metadata/topicId" },
        ],
        kind: "invalid",
        scope: "publication",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Material сохранён")).toBeVisible();
    await expect(canvas.getByText("Перед публикацией")).toBeVisible();
    await expect(canvas.getByText("Назначьте формат перед публикацией.")).toBeVisible();
    await expect(canvas.getByText("Назначьте тему перед публикацией.")).toBeVisible();
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

export const PreviewUnauthorized: Story = {
  args: { presentation: materialAuthoringPresentation },
  render: () => <MaterialAuthoringPreviewUnauthorizedState />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Нет доступа к Preview");
    await expect(canvas.getByRole("link", { name: "Вернуться к материалам" })).toBeVisible();
  },
};

export const PreviewUnexpectedError: Story = {
  args: { presentation: materialAuthoringPresentation },
  render: () => (
    <MaterialAuthoringUnexpectedPreviewState
      reference="preview_unavailable"
      retryHref="/authoring/materials/94000000-0000-4000-8000-000000000099/preview"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Не удалось открыть Preview");
    await expect(canvas.getByText("Код обращения: preview_unavailable")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Повторить" })).toBeVisible();
  },
};

export const PreviewNotFound: Story = {
  args: { presentation: materialAuthoringPresentation },
  render: () => <MaterialAuthoringPreviewNotFoundState />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Preview не найден");
    await expect(canvas.queryByRole("link", { name: "Повторить" })).not.toBeInTheDocument();
  },
};

export const InitialEditorUnexpectedError: Story = {
  args: { presentation: materialAuthoringPresentation },
  render: () => <MaterialAuthoringUnexpectedEditorState reference="identity-session" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("Не удалось открыть редактор");
    await expect(canvas.getByText("Код обращения: identity-session")).toBeVisible();
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
    await expect(canvas.getByRole("heading", { name: "Preview текущей версии" })).toBeInTheDocument();
    await expect(canvas.getAllByText(/v3/).length).toBeGreaterThan(0);
    await expect(canvasElement.querySelector("[data-preview-version-banner]")).toHaveTextContent(
      "Это сохранённый черновик v3. Материал ещё не опубликован.",
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
    await expect(canvas.getByRole("heading", { name: "Preview текущей версии" })).toBeInTheDocument();
    await expect(canvas.getAllByText(/v3/).length).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Conflict: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      blocking: {
        currentContentVersion: 4,
        kind: "conflict",
        staleContentVersion: 3,
      },
      save: { kind: "dirty" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Ваш локальный ввод останется здесь",
    );
    await expect(canvas.getByLabelText("Название")).toHaveValue(
      "Developer Pipeline без магии",
    );
    await expect(canvas.getByRole("button", { name: "Сравнить" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Открыть текущую" }));
    await expect(noopActions.onConflictAction).toHaveBeenCalledWith("open_current");
    await expect(canvas.getByLabelText("Название")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Полужирный" })).toBeDisabled();
  },
};

export const Published: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      draft: { ...materialAuthoringPresentation.draft, status: "published" },
      preview: {
        ...materialAuthoringPresentation.preview,
        publicationState: "published",
      },
      save: { kind: "saved", savedAtLabel: "12:41" },
      validation: { headingCount: 1, kind: "valid", plainTextLength: 214 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Опубликован").length).toBeGreaterThan(0);
    await expect(canvas.getByLabelText("Адрес")).toHaveAttribute("readonly");
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    await expect(canvasElement.querySelector("[data-preview-version-banner]")).toHaveTextContent(
      "Это текущая live-версия v3.",
    );
  },
};

export const Unpublished: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      draft: { ...materialAuthoringPresentation.draft, status: "unpublished" },
      save: { kind: "saved", savedAtLabel: "12:41" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Снят с публикации").length).toBeGreaterThan(0);
    await expect(canvas.getByLabelText("Название")).toBeEnabled();
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
