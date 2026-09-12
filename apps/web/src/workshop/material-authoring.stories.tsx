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
} from "@/widgets/material-authoring";
import {
  authoringMaterialsRootHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";

import {
  emptyLessonBlocks,
  emptyMaterialAuthoringPresentation,
  imageAttachmentPresentation,
  longLessonBlocks,
  materialAuthoringPresentation,
  savedAfterEditingPresentation,
  savedContentVersion,
} from "./material-authoring.fixtures";
import { authoringPageEnvironment, routeContent } from "./story-environment";

const noopActions = {
  onBack: fn(),
  onConflictAction: fn(),
  onDocumentChange: fn(),
  onDelete: fn(),
  onFieldChange: fn(),
  onOpenPreview: fn(),
  onOutcomesChange: fn(),
  onPrimaryVideoChange: fn(),
  onRetry: fn(),
  onReturnToEditor: fn(),
  onSave: fn(),
  onSeriesToggle: fn(),
  onTagToggle: fn(),
} satisfies MaterialAuthoringActions;
const recordSavedPublicationState = fn(
  (publicationState: "draft" | "published" | "unpublished") => publicationState,
);

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
    onDelete: (input) => {
      noopActions.onDelete(input);
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
    onPrimaryVideoChange: (primaryVideo, deleteVideoId) => {
      noopActions.onPrimaryVideoChange(primaryVideo, deleteVideoId);
      markDirty({
        ...presentation.draft,
        deleteVideoId,
        primaryVideo,
        primaryVideoId: primaryVideo?.videoId ?? null,
      });
    },
    onOutcomesChange: (outcomes) => {
      noopActions.onOutcomesChange(outcomes);
      markDirty({ ...presentation.draft, outcomes });
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
    onSave: (publicationState) => {
      noopActions.onSave();
      recordSavedPublicationState(publicationState);
      setPresentation(savedAfterEditingPresentation);
    },
    onSeriesToggle: (seriesId, checked) => {
      noopActions.onSeriesToggle(seriesId, checked);
      markDirty({
        ...presentation.draft,
        seriesIds: checked
          ? [...presentation.draft.seriesIds, seriesId]
          : presentation.draft.seriesIds.filter(
              (candidate) => candidate !== seriesId,
            ),
      });
    },
    onTagToggle: (tagId: string, checked: boolean) => {
      noopActions.onTagToggle(tagId, checked);
      markDirty({
        ...presentation.draft,
        tagIds: checked
          ? [...presentation.draft.tagIds, tagId]
          : presentation.draft.tagIds.filter(
              (candidate) => candidate !== tagId,
            ),
      });
    },
  } satisfies MaterialAuthoringActions;

  return (
    <MaterialAuthoringWorkspace actions={actions} presentation={presentation} />
  );
}

const environment = authoringPageEnvironment("/authoring/materials/96000000-0000-4000-8000-000000000001");

const meta = {
  ...environment,
  args: {
    actions: noopActions,
    presentation: materialAuthoringPresentation,
  },
  component: MaterialAuthoringWorkspace,
  parameters: {
    ...environment.parameters,
    controls: {
      exclude: ["actions"],
    },
    docs: {
      description: {
        component:
          "Production-композиция редактора и точного предпросмотра. Сценарии передают только сериализуемые данные представления; transport, авторизация и сохранение остаются вне UI-модуля.",
      },
    },
  },
  render: ({ presentation }) => (
    <MaterialAuthoringFixture initialPresentation={presentation} />
  ),
  title: "Страницы/Редактор/Материал и предпросмотр",
} satisfies Meta<typeof MaterialAuthoringWorkspace>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptyNewDraft: Story = {
  args: { presentation: emptyMaterialAuthoringPresentation },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  name: "Новый черновик · мобильный",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Новый материал" }),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText("Название")).toHaveValue("");
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Опубликовать" }),
    ).toBeDisabled();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Editing: Story = {
  name: "Редактирование",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("group", { name: /^Руководства/u }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("checkbox", { name: "Создание Platform Inside" }),
    ).toBeChecked();
    await expect(canvas.queryByRole("spinbutton")).not.toBeInTheDocument();
    const title = canvas.getByLabelText("Название");
    await userEvent.clear(title);
    await userEvent.type(title, "Новая версия Developer Pipeline");
    await expect(canvas.getAllByText(/Не сохранено/u).length).toBeGreaterThan(
      0,
    );
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeEnabled();
    await userEvent.type(title, "{enter}");
    await expect(recordSavedPublicationState).toHaveBeenLastCalledWith("draft");
    await expect(
      canvas.queryByText(`v${String(savedContentVersion)}`),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Версия", { exact: true }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Предпросмотр" }));
    await expect(
      canvas.getByRole("heading", { name: "Новая версия Developer Pipeline" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText(`v${String(savedContentVersion)}`),
    ).not.toBeInTheDocument();
  },
};

/**
 * Блоки урока в редакторе: их видно в меню вставки, вид врезки переключается, а название врезки
 * автор задаёт на месте. До #505 меню вставляло только `note` и сменить вид было нечем.
 */
export const LessonBlocksEditing: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Редактор · блоки урока",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openMenu = async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Добавить блок" }));
      return canvas.getByRole("dialog", { name: "Добавить блок" });
    };

    let menu = await openMenu();
    for (const name of [
      "Заголовок H4",
      "Ключевая мысль",
      "Итоги",
      "Промпт",
      "Ресурс",
      "Термины",
      "Совет",
      "Важно",
      "Пример",
      "Хорошо",
      "Плохо",
      "Определение",
    ]) {
      await expect(within(menu).getByRole("button", { name })).toBeVisible();
    }

    await userEvent.click(within(menu).getByRole("button", { name: "Совет" }));
    await expect(canvasElement.querySelector('aside[data-callout="tip"]')).toBeVisible();

    const tip = canvas.getByRole("button", { name: "Вид врезки: Совет" });
    await expect(tip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Вид врезки: Важно" }));
    const warning = canvasElement.querySelector('aside[data-callout="warning"]');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveTextContent("Важно");

    await userEvent.type(canvas.getByLabelText("Название врезки"), "Не забудьте");
    await expect(canvasElement.querySelector('aside[data-callout="warning"]')).toHaveTextContent(
      "Не забудьте",
    );

    menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Итоги" }));
    await expect(
      canvasElement.querySelector('section[data-material-block="takeaways"]'),
    ).toBeVisible();
    await expect(canvas.getByLabelText("Заголовок итогов")).toHaveValue("Итоги урока");

    menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Ресурс" }));
    await userEvent.type(canvas.getByLabelText("Название ресурса"), "Спецификация");
    await userEvent.type(
      canvas.getByLabelText("Адрес ресурса"),
      "https://example.com/spec",
    );
    await expect(canvas.getByLabelText("Адрес ресурса")).toHaveValue(
      "https://example.com/spec",
    );

    menu = await openMenu();
    await userEvent.click(within(menu).getByRole("button", { name: "Термины" }));
    await userEvent.type(canvas.getByLabelText("Метка строки 1"), "ADR");
    await userEvent.click(canvas.getByRole("button", { name: "Добавить строку" }));
    await expect(canvas.getByLabelText("Метка строки 2")).toHaveValue("");

    // Буфер обмена восстанавливает узел из разметки, поэтому название обязано быть в
    // DOM-атрибуте, а не только в тексте. Карточка ресурса и термины показывают в редакторе
    // собственную форму, поэтому их разметку проверяет не эта story, а схема документа.
    await expect(canvasElement.querySelector("aside[data-callout]")).toHaveAttribute(
      "data-callout-title",
      "Не забудьте",
    );
    await expect(
      canvasElement.querySelector('section[data-material-block="takeaways"]'),
    ).toHaveAttribute("data-takeaways-title", "Итоги урока");

    // Панель блока принадлежит текущей врезке: вернувшись в неё, автор снова меняет её вид.
    const callout = canvasElement.querySelector("aside[data-callout] [data-callout-body] p");
    if (callout === null) throw new Error("Врезка не найдена");
    await userEvent.click(callout);
    await expect(canvas.getByRole("button", { name: "Вид врезки: Важно" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByLabelText("Название врезки")).toHaveValue("Не забудьте");
  },
};

/** Незаполненные блоки урока в тёмной теме: автор вставил блок и ещё не написал содержимое. */
export const ExactPreviewEmptyDark: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      mode: "preview",
      preview:
        materialAuthoringPresentation.preview === null
          ? null
          : { ...materialAuthoringPresentation.preview, blocks: emptyLessonBlocks },
    },
  },
  globals: { theme: "dark", viewport: { isRotated: false, value: "mobile390" } },
  name: "Предпросмотр · пустые блоки, тёмная тема",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("link", { name: /Открыть/u })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Примечание")).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Итоги" })).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

/** Длинное содержимое в тёмной теме на самой узкой ширине: переносы и отсутствие прокрутки вбок. */
export const ExactPreviewLongDark: Story = {
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      mode: "preview",
      preview:
        materialAuthoringPresentation.preview === null
          ? null
          : { ...materialAuthoringPresentation.preview, blocks: longLessonBlocks },
    },
  },
  globals: { theme: "dark", viewport: { isRotated: false, value: "mobile320" } },
  name: "Предпросмотр · длинные блоки, тёмная тема",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: /Копировать/u })).toBeVisible();
    await expect(canvas.getByLabelText(/^Важно/u)).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const DeleteDraftConfirmation: Story = {
  name: "Удаление безопасного черновика",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByText("Удалить черновик", { selector: "summary" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Удалить черновик" }),
    );
    const dialog = canvas.getByRole("dialog", {
      name: "Удалить «Developer Pipeline без магии»?",
    });
    await expect(dialog).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Оставить черновик" }),
    );
    await expect(dialog).not.toBeVisible();
  },
};

export const Dirty: Story = {
  name: "Есть изменения",
  args: {
    presentation: { ...materialAuthoringPresentation, save: { kind: "dirty" } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText(/Не сохранено/u).length).toBeGreaterThan(
      0,
    );
    await expect(canvas.getByLabelText("Название")).toBeEnabled();
  },
};

export const Submitting: Story = {
  name: "Сохранение",
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      save: { kind: "submitting" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Название")).toBeEnabled();
    for (const status of canvas.getAllByText(/Сохранение…/u)) {
      await expect(status).toBeVisible();
    }
  },
};

export const Saved: Story = {
  name: "Сохранено",
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      save: { kind: "saved", savedAtLabel: "12:41" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText(/Сохранено 12:41/u).length,
    ).toBeGreaterThan(0);
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeEnabled();
    await expect(
      canvas.queryByRole("button", { name: "Сохранить" }),
    ).not.toBeInTheDocument();
    // Первым в порядке обхода стоит содержимое маршрута: оболочку проверяет её собственная story.
    within(canvasElement).getByRole("main").focus();
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Вернуться к материалам" }),
    ).toHaveFocus();
    await userEvent.tab();
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toHaveFocus();
  },
};

export const CreatedDraft: Story = {
  name: "Черновик создан",
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
          {
            message: "Назначьте формат перед публикацией.",
            path: "/metadata/formatId",
          },
          {
            message: "Назначьте тему перед публикацией.",
            path: "/metadata/topicId",
          },
        ],
        kind: "invalid",
        scope: "publication",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Название")).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeEnabled();
  },
};

export const ValidationPassed: Story = {
  name: "Проверка пройдена",
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      save: { kind: "saved", savedAtLabel: "12:41" },
      validation: { headingCount: 2, kind: "valid", plainTextLength: 286 },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/2 заголовков/)).not.toBeInTheDocument();
  },
};

export const ValidationIssues: Story = {
  name: "Есть замечания",
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
          {
            message: "Назначьте формат перед публикацией.",
            path: "/metadata/formatId",
          },
          {
            message: "Назначьте тему перед публикацией.",
            path: "/metadata/topicId",
          },
        ],
        kind: "invalid",
        scope: "publication",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Перед публикацией")).toBeVisible();
    await expect(
      canvas.getByText("Назначьте формат перед публикацией."),
    ).toBeVisible();
    await expect(
      canvas.getByText("Назначьте тему перед публикацией."),
    ).toBeVisible();
  },
};

export const Unauthorized: Story = {
  name: "Нет доступа к редактору",
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      authorization: { kind: "unauthorized" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Нет доступа к редактору" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

export const PreviewUnauthorized: Story = {
  name: "Нет доступа к предпросмотру",
  args: { presentation: materialAuthoringPresentation },
  render: () => <MaterialAuthoringPreviewUnauthorizedState />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Нет доступа к предпросмотру",
    );
    await expect(
      canvas.getByRole("link", { name: "Вернуться к материалам" }),
    ).toBeVisible();
  },
};

export const PreviewUnexpectedError: Story = {
  name: "Ошибка предпросмотра",
  args: { presentation: materialAuthoringPresentation },
  render: () => (
    <MaterialAuthoringUnexpectedPreviewState
      reference="preview_unavailable"
      retryHref={withAuthoringReturnHref(
        "/authoring/materials/94000000-0000-4000-8000-000000000099/preview",
        authoringMaterialsRootHref,
      )}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Не удалось открыть предпросмотр",
    );
    await expect(
      canvas.getByText("Код обращения: preview_unavailable"),
    ).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Повторить" })).toBeVisible();
  },
};

export const PreviewNotFound: Story = {
  name: "Предпросмотр не найден",
  args: { presentation: materialAuthoringPresentation },
  render: () => <MaterialAuthoringPreviewNotFoundState />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Предпросмотр не найден",
    );
    await expect(
      canvas.queryByRole("link", { name: "Повторить" }),
    ).not.toBeInTheDocument();
  },
};

export const InitialEditorUnexpectedError: Story = {
  name: "Ошибка открытия редактора",
  args: { presentation: materialAuthoringPresentation },
  render: () => (
    <MaterialAuthoringUnexpectedEditorState reference="identity-session" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Не удалось открыть редактор",
    );
    await expect(
      canvas.getByText("Код обращения: identity-session"),
    ).toBeVisible();
  },
};

export const ExactPreview: Story = {
  args: {
    presentation: { ...materialAuthoringPresentation, mode: "preview" },
  },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Предпросмотр · широкий экран",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Предпросмотр материала" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("v3", { exact: true }),
    ).not.toBeInTheDocument();
    await expect(
      canvasElement.querySelector("[data-preview-status-banner]"),
    ).toHaveTextContent("Сохранённый черновик. Материал ещё не опубликован.");
    await expect(
      canvas.getByRole("heading", { name: "Developer Pipeline без магии" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("region", { name: "Таблица в предпросмотре" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("img", { name: "Схема Developer Pipeline" }),
    ).toBeVisible();
    await expect(canvas.getByText("Checklist проверки")).toBeVisible();
  },
};

export const ExactPreviewMobile: Story = {
  args: {
    presentation: { ...materialAuthoringPresentation, mode: "preview" },
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Предпросмотр · мобильный",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Предпросмотр материала" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByText("v3", { exact: true }),
    ).not.toBeInTheDocument();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

/**
 * Блоки урока в тёмной теме. Читательский маршрут всегда светлый, а авторская оболочка тему
 * уважает, поэтому тёмное состояние блоков проверяется здесь.
 */
export const ExactPreviewDark: Story = {
  args: {
    presentation: { ...materialAuthoringPresentation, mode: "preview" },
  },
  globals: { theme: "dark", viewport: { isRotated: false, value: "mobile390" } },
  name: "Предпросмотр · тёмная тема",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const definition = canvas.getByLabelText("Определение: Правило одного источника");
    await expect(definition).toBeVisible();
    // Вид врезки берёт свой токен, и в тёмной теме это тёмное значение, а не светлое.
    const styles = getComputedStyle(definition);
    await expect(styles.getPropertyValue("--callout-ink").trim()).toBe(
      styles.getPropertyValue("--callout-definition").trim(),
    );
    await expect(canvas.getByRole("region", { name: "Итоги урока" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /Копировать/u })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /Открыть/u })).toBeVisible();
    await expect(canvas.getByText("Фиксирует необратимый выбор")).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Conflict: Story = {
  name: "Конфликт сохранения",
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
    await expect(
      canvas.getByRole("button", { name: "Сравнить" }),
    ).toBeEnabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть текущую" }),
    );
    await expect(noopActions.onConflictAction).toHaveBeenCalledWith(
      "open_current",
    );
    await expect(canvas.getByLabelText("Название")).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Добавить блок" }),
    ).toBeEnabled();
  },
};

export const Published: Story = {
  name: "Опубликован",
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
    await expect(canvas.queryByLabelText("Адрес")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Предпросмотр" }));
    await expect(
      canvasElement.querySelector("[data-preview-status-banner]"),
    ).toHaveTextContent("Материал опубликован и доступен читателям.");
  },
};

export const Unpublished: Story = {
  name: "Снят с публикации",
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      draft: { ...materialAuthoringPresentation.draft, status: "unpublished" },
      save: { kind: "saved", savedAtLabel: "12:41" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText("Снят с публикации").length,
    ).toBeGreaterThan(0);
    await expect(canvas.getByLabelText("Название")).toBeEnabled();
  },
};

export const InfrastructureError: Story = {
  name: "Ошибка сервиса",
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      blocking: { correlationId: "req_8F3K2M", kind: "infrastructure_error" },
      save: { kind: "dirty" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Изменения остаются в редакторе",
    );
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
  name: "Мобильный · текст 200%",
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectNoHorizontalOverflow(canvasElement);
      await expect(
        within(canvasElement).getByRole("button", { name: "Опубликовать" }),
      ).toBeVisible();
    } finally {
      root.style.fontSize = previousFontSize;
    }
  },
};

export const SearchableSeries: Story = {
  name: "Руководства · поиск и продолжение списка",
  args: {
    presentation: {
      ...materialAuthoringPresentation,
      availableSeries: Array.from({ length: 45 }, (_, index) => ({
        label: `Руководство ${String(index + 1).padStart(2, "0")}`,
        value: `94000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      })),
      draft: { ...materialAuthoringPresentation.draft, seriesIds: [] },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const series = within(canvas.getByLabelText("Выбор руководств"));
    await expect(series.getAllByRole("checkbox")).toHaveLength(20);
    const more = series.getByRole("button", { name: "Показать ещё" });
    more.focus();
    await userEvent.keyboard("{Enter}");
    await expect(series.getAllByRole("checkbox").length).toBeGreaterThan(20);
    await userEvent.type(canvas.getByLabelText("Поиск руководств"), "Руководство 45");
    await expect(series.getAllByRole("checkbox")).toHaveLength(1);
    await expect(series.getByRole("checkbox", { name: "Руководство 45" })).toBeVisible();
    const page = routeContent(canvasElement);
    await expect(page.getAllByText("Теги", { exact: true })).toHaveLength(1);
    await expect(page.getAllByText("Руководства", { exact: true })).toHaveLength(1);
  },
};

export const ImageAttachment: Story = {
  name: "Вложенное изображение · форма вложения",
  args: { presentation: imageAttachmentPresentation },
  play: async ({ canvasElement }) => {
    const form = within(imageAttachment(canvasElement));
    // The description is a field of the attachment form: visible and writable as it stands.
    const description = form.getByLabelText("Описание изображения");
    await expect(description).toBeVisible();
    await userEvent.type(description, "Путь задачи от issue до owner GO");
    await expect(description).toHaveValue("Путь задачи от issue до owner GO");
    await expect(form.getByLabelText("Подпись изображения")).toBeVisible();
    await expect(form.getByLabelText("Размер изображения")).toBeVisible();
  },
};

export const ImageAttachmentMobile: Story = {
  args: { presentation: imageAttachmentPresentation },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Вложенное изображение · мобильный",
  play: async ({ canvasElement }) => {
    const form = within(imageAttachment(canvasElement));
    await expect(form.getByLabelText("Описание изображения")).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

function imageAttachment(canvasElement: HTMLElement): HTMLElement {
  const attachment = canvasElement.querySelector("[data-node-view-wrapper]");
  if (!(attachment instanceof HTMLElement)) {
    throw new Error("The article has no attachment block");
  }
  return attachment;
}

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const storyWindow = canvasElement.ownerDocument.defaultView;
  if (storyWindow === null) {
    throw new Error("Story window is unavailable");
  }
  await expect(
    canvasElement.ownerDocument.documentElement.scrollWidth,
  ).toBeLessThanOrEqual(storyWindow.innerWidth + 1);
}
