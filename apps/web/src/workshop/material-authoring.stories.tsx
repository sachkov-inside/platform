import type { JSONContent } from "@tiptap/core";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  MaterialAuthoringWorkspace,
  type MaterialAuthoringActions,
  type MaterialAuthoringPresentation,
  type MaterialDraftField,
  type MaterialPreviewBlock,
  type MaterialPreviewMark,
  type MaterialPreviewPresentation,
  type MaterialPreviewText,
} from "@/features/material-authoring";

import {
  emptyMaterialAuthoringPresentation,
  invalidMaterialAuthoringPresentation,
  materialAuthoringPresentation,
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
  onValidate: fn(),
} satisfies MaterialAuthoringActions;

const savedRevisionId = "rev_01JY7C6RE4M2W9PK5AHN";

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
      setPresentation((current) => {
        const draft = {
          ...current.draft,
          materialId: current.draft.materialId ?? "mat_developer_pipeline",
          revisionId: savedRevisionId,
          status: "draft" as const,
        };
        return {
          ...current,
          draft,
          preview: projectPreview(draft, savedRevisionId),
          save: { kind: "saved", savedAtLabel: "12:41" },
          validation: { kind: "unchecked" },
        };
      });
    },
    onValidate: () => {
      noopActions.onValidate();
      setPresentation((current) => ({ ...current, validation: { kind: "checking" } }));
      window.setTimeout(() => {
        setPresentation((current) => ({
          ...current,
          validation:
            current.draft.title.trim().length === 0
              ? invalidMaterialAuthoringPresentation.validation
              : { kind: "valid", checkedAtLabel: "12:42" },
        }));
      }, 120);
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
    await expect(canvas.getAllByText("Есть несохранённые изменения", { exact: true }).length).toBeGreaterThan(0);
    await expect(canvas.getByRole("button", { name: "Preview" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить" }));
    await expect(canvas.getAllByText(savedRevisionId).length).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole("button", { name: "Preview" }));
    await expect(canvas.getByRole("heading", { name: "Новая редакция Developer Pipeline" })).toBeInTheDocument();
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
    await expect(canvas.getByRole("button", { name: "Сохранение…" })).toBeDisabled();
    await expect(canvas.getAllByText("Сохранение…").length).toBeGreaterThan(0);
  },
};

export const Saved: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      save: { kind: "saved", savedAtLabel: "12:41" },
      validation: { kind: "valid", checkedAtLabel: "12:40" },
    },
  },
  name: "Saved and validated",
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

export const ValidationError: Story = {
  args: { presentation: invalidMaterialAuthoringPresentation },
  name: "Validation error",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const titleIssue = canvas.getByRole("button", { name: /Название/ });
    await expect(canvas.getByRole("alert")).toHaveTextContent("Материал пока нельзя опубликовать");
    await userEvent.click(titleIssue);
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
    await userEvent.click(canvas.getByRole("button", { name: "Проверить" }));
    await expect(canvas.getByText("Проверяем exact revision…")).toBeInTheDocument();
    await expect(await canvas.findByText("Ошибок нет · 12:42")).toBeInTheDocument();
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
      validation: { kind: "valid", checkedAtLabel: "12:40" },
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

function projectPreview(
  draft: MaterialAuthoringPresentation["draft"],
  exactRevisionId: string,
): MaterialPreviewPresentation {
  return {
    accessLabel: draft.access === "membership" ? "Для участников" : "Бесплатный",
    blocks: projectBlocks(draft.document.content ?? []),
    exactRevisionId,
    format: draft.format,
    summary: draft.summary,
    tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    title: draft.title,
    topic: draft.topic,
  };
}

function projectBlocks(nodes: readonly JSONContent[]): readonly MaterialPreviewBlock[] {
  return nodes.flatMap((node): readonly MaterialPreviewBlock[] => {
    switch (node.type) {
      case "paragraph":
        return [{ content: projectInline(node.content ?? []), kind: "paragraph" }];
      case "heading": {
        const rawLevel = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
        const level = Math.min(4, Math.max(2, rawLevel)) as 2 | 3 | 4;
        return [{ content: projectInline(node.content ?? []), kind: "heading", level }];
      }
      case "bulletList":
      case "orderedList":
        return [{
          items: (node.content ?? []).map((item) => projectBlocks(item.content ?? [])),
          kind: node.type === "bulletList" ? "bullet_list" : "ordered_list",
        }];
      case "blockquote":
        return [{ content: projectBlocks(node.content ?? []), kind: "blockquote" }];
      case "codeBlock":
        return [{ kind: "code_block", text: collectText(node.content ?? []) }];
      case "horizontalRule":
        return [{ kind: "horizontal_rule" }];
      case undefined:
      default:
        return [];
    }
  });
}

function projectInline(nodes: readonly JSONContent[]): readonly MaterialPreviewText[] {
  return nodes.flatMap((node): readonly MaterialPreviewText[] => {
    if (node.type !== "text" || typeof node.text !== "string") {
      return [];
    }
    return [{
      kind: "text",
      marks: (node.marks ?? []).flatMap((mark): readonly MaterialPreviewMark[] => {
        if (mark.type === "link" && typeof mark.attrs?.href === "string") {
          return [{ href: mark.attrs.href, kind: "link" }];
        }
        if (mark.type === "bold" || mark.type === "code" || mark.type === "italic" || mark.type === "strike") {
          return [{ kind: mark.type }];
        }
        return [];
      }),
      text: node.text,
    }];
  });
}

function collectText(nodes: readonly JSONContent[]): string {
  return nodes.map((node) => node.text ?? collectText(node.content ?? [])).join("");
}
