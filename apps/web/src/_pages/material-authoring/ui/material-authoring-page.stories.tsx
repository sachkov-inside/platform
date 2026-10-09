import {
  AutosaveActivity,
  autosaveWhileHidden,
} from "@/storybook/autosave-activity";
import { act, Profiler } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  expect,
  fn,
  mocked,
  spyOn,
  userEvent,
  waitFor,
  within,
} from "storybook/test";

import {
  authoringMaterialsRootHref,
  authoringProductEditorHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";
import {
  MaterialAuthoringNotFoundState,
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
  MaterialAuthoringUnexpectedEditorState,
} from "@/widgets/material-authoring/route-states";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  imageAttachmentPresentation,
  materialAuthoringPresentation,
  materialBeforeRender,
  materialId,
  materialRequests,
  savedReply,
  variantStepAuthoringPresentation,
  type MaterialReplies,
} from "./material-authoring.fixtures";
import { MaterialAuthoringPageClient } from "./material-authoring-page.client";

import { MaterialMetadataPanel } from "@/widgets/material-authoring/ui/material-metadata-panel.client";
import { MaterialAuthoringHeader } from "@/widgets/material-authoring/ui/material-authoring-chrome.client";
import { ContentCoverEditor } from "@/features/content-covers";
import { MaterialVideoAuthoring } from "@/features/material-video";

const typingProfile = fn<(duration: number) => void>();
const editorPath = `/authoring/materials/${materialId}`;
const environment = authoringPageEnvironment(editorPath);

/** Автосохранение страницы проходит: черновик сохраняется после каждой паузы в наборе. */
const savesDraft: MaterialReplies = { PUT: savedReply() };

const meta = {
  ...environment,
  beforeEach: [environment.beforeEach, materialBeforeRender(savesDraft)],
  args: {
    initialPresentation: materialAuthoringPresentation,
    returnHref: authoringMaterialsRootHref,
  },
  component: MaterialAuthoringPageClient,
  parameters: {
    ...environment.parameters,
    controls: { exclude: ["initialPresentation"] },
    docs: {
      description: {
        component:
          "Редактор сохранённого материала на маршруте `/authoring/materials/<id>`: production-страница " +
          "с автосохранением, публикацией и удалением черновика. Ответы сохранения подменяют BFF " +
          "`/api/authoring/materials`, состояние на экране выбирает сама страница.",
      },
    },
  },
  title: "Pages/Authoring/Material editor",
} satisfies Meta<typeof MaterialAuthoringPageClient>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Последняя отправленная форма сохранения: поле по имени. */
function savedField(name: string): FormDataEntryValue | null | undefined {
  const call = materialRequests.mock.calls.findLast(
    ([method]) => method === "PUT",
  );
  return call?.[1]?.get(name);
}

/** Правка названия переводит черновик в «Не сохранено», пауза сохраняет его через BFF. */
export const Editing: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Редактирование и автосохранение",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("group", { name: /^Продукты/u }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("checkbox", { name: "Создание Platform Inside" }),
    ).toBeChecked();
    await expect(canvas.queryByRole("spinbutton")).not.toBeInTheDocument();
    await expect(canvas.getAllByText(/Без изменений/u).length).toBeGreaterThan(
      0,
    );
    const title = canvas.getByLabelText("Название");
    await userEvent.clear(title);
    await userEvent.type(title, "Новая версия Developer Pipeline", {
      delay: null,
    });
    await expect(canvas.getAllByText(/Не сохранено/u).length).toBeGreaterThan(
      0,
    );
    await expect(
      (await canvas.findAllByText(/Сохранено сейчас/u)).length,
    ).toBeGreaterThan(0);
    await expect(savedField("title")).toBe("Новая версия Developer Pipeline");
    await expect(savedField("publicationState")).toBe("draft");
    await expect(savedField("expectedContentVersion")).toBe("3");
    await expect(
      canvas.queryByText("Версия", { exact: true }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeEnabled();
  },
};

/** Материал открыт из предпросмотра продукта: возврат ведёт в редактор продукта (#837). */
export const FromProductEditor: Story = {
  args: {
    returnHref: authoringProductEditorHref(
      "95000000-0000-4000-8000-000000000010",
    ),
  },
  name: "Открыт из редактора продукта",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Вернуться к продукту" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Вернуться к материалам" }),
    ).toBeNull();
  },
};

export const EditingMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Редактирование · мобильный",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("Название")).toHaveValue(
      "Developer Pipeline без магии",
    );
    await expectNoHorizontalOverflow(canvasElement);
  },
};

/** Содержимое маршрута стоит первым в порядке обхода, за ним — возврат и предпросмотр. */
export const KeyboardOrder: Story = {
  name: "Порядок обхода с клавиатуры",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
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

/** Ответ сохранения ещё не пришёл: поля остаются доступными, статус говорит «Сохранение…». */
export const Submitting: Story = {
  name: "Сохранение",
  beforeEach: materialBeforeRender({ PUT: "pending" }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Название"), "!", {
      delay: null,
    });
    await expect(
      (await canvas.findAllByText(/Сохранение…/u)).length,
    ).toBeGreaterThan(0);
    await expect(canvas.getByLabelText("Название")).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Опубликовать" }),
    ).toBeDisabled();
  },
};

/** Материал изменился в другой сессии: локальный ввод остаётся, автор выбирает способ переноса. */
export const Conflict: Story = {
  name: "Конфликт сохранения",
  beforeEach: materialBeforeRender({
    PUT: { currentContentVersion: 4, kind: "conflict", staleContentVersion: 3 },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Название"), "!", {
      delay: null,
    });
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Ваш локальный ввод останется здесь",
    );
    await expect(canvas.getByLabelText("Название")).toHaveValue(
      "Developer Pipeline без магии!",
    );
    for (const name of ["Сравнить", "Открыть текущую"])
      await expect(canvas.getByRole("button", { name })).toBeEnabled();
    await expect(canvas.getByLabelText("Название")).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Добавить блок" }),
    ).toBeEnabled();
  },
};

/** Сервис не ответил: изменения остаются в редакторе, повтор отправляет тот же черновик. */
export const InfrastructureError: Story = {
  name: "Ошибка сервиса и повтор",
  beforeEach: materialBeforeRender({
    PUT: [{ httpStatus: 503 }, savedReply()],
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Название"), "!", {
      delay: null,
    });
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Изменения остаются в редакторе",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await waitFor(() =>
      expect(canvas.queryByRole("alert")).not.toBeInTheDocument(),
    );
    await expect(materialRequests).toHaveBeenCalledTimes(2);
  },
};

/** Материал удалили в другой сессии: страница не показывает ложного сохранения. */
export const NotFoundWhileSaving: Story = {
  name: "Материал удалён во время правки",
  beforeEach: materialBeforeRender({ PUT: { kind: "not_found" } }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Название"), "!", {
      delay: null,
    });
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Материал больше не найден",
    );
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeDisabled();
  },
};

/** Сессия закончилась во время правки: редактор сменяется экраном входа. */
export const SignedOutWhileSaving: Story = {
  name: "Сессия закончилась во время правки",
  beforeEach: materialBeforeRender({ PUT: { httpStatus: 401 } }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Название"), "!", {
      delay: null,
    });
    await expect(
      await canvas.findByRole("heading", { name: "Нет доступа к редактору" }),
    ).toBeVisible();
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

/** Публикация отклонена: сервер назвал поля, которые нужно заполнить перед публикацией. */
export const PublicationIssues: Story = {
  name: "Публикация отклонена",
  args: {
    initialPresentation: {
      ...materialAuthoringPresentation,
      draft: {
        ...materialAuthoringPresentation.draft,
        formatId: "unassigned",
        tagIds: [],
        topicId: "unassigned",
      },
    },
  },
  beforeEach: materialBeforeRender({
    PUT: {
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
      kind: "invalid_input",
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Опубликовать" }));
    await expect(await canvas.findByText("Перед публикацией")).toBeVisible();
    await expect(
      canvas.getByText("Назначьте формат перед публикацией."),
    ).toBeVisible();
    await expect(
      canvas.getByText("Назначьте тему перед публикацией."),
    ).toBeVisible();
    await expect(
      canvas.getByText("Не удалось опубликовать. Проверьте отмеченные поля."),
    ).toBeVisible();
    await expect(savedField("publicationState")).toBe("published");
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

const publishedPresentation = {
  ...materialAuthoringPresentation,
  draft: {
    ...materialAuthoringPresentation.draft,
    canDelete: false,
    status: "published",
  },
} as const;

const removalRequired = {
  products: [
    {
      productId: materialAuthoringPresentation.draft.seriesIds[0],
      holders: 12,
      name: "Создание Platform Inside",
    },
  ],
  kind: "removal_confirmation_required",
} as const;

export const Published: Story = {
  name: "Опубликован",
  args: { initialPresentation: publishedPresentation },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Опубликован").length).toBeGreaterThan(0);
    await expect(canvas.queryByLabelText("Адрес")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Снять с публикации" }),
    ).toBeEnabled();
  },
};

/** Снятие с публикации уберёт материал из купленного продукта: сервер просит подтверждения. */
export const ProductRemovalConfirmation: Story = {
  name: "Подтверждение снятия из купленного продукта",
  args: { initialPresentation: publishedPresentation },
  beforeEach: materialBeforeRender({
    PUT: [removalRequired, savedReply("unpublished")],
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Снять с публикации" }),
    );
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", {
      name: "Снять материал из купленного продукта?",
    });
    await expect(
      within(dialog).getByText("«Создание Platform Inside»"),
    ).toBeVisible();
    await expect(within(dialog).getByText("доступ у 12 человек")).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Снять из продукта" }),
    );
    await expect(
      (await canvas.findAllByText("Снят с публикации")).length,
    ).toBeGreaterThan(0);
    await expect(savedField("confirmedProductRemovals")).toBe(
      removalRequired.products[0].productId,
    );
  },
};

export const ProductRemovalCancelled: Story = {
  name: "Снятие из купленного продукта отменено",
  args: { initialPresentation: publishedPresentation },
  beforeEach: materialBeforeRender({ PUT: removalRequired }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Снять с публикации" }),
    );
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("dialog", {
      name: "Снять материал из купленного продукта?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Оставить в продукте" }),
    );
    await expect(
      page.queryByRole("dialog", {
        name: "Снять материал из купленного продукта?",
      }),
    ).toBeNull();
    await expect(canvas.getAllByText("Опубликован").length).toBeGreaterThan(0);
    await expect(
      canvas.getByRole("checkbox", { name: "Создание Platform Inside" }),
    ).toBeChecked();
  },
};

export const Unpublished: Story = {
  name: "Снят с публикации",
  args: {
    initialPresentation: {
      ...materialAuthoringPresentation,
      draft: {
        ...materialAuthoringPresentation.draft,
        canDelete: false,
        status: "unpublished",
      },
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

/** Материал из Inside Content: редактор показывает его только для чтения и называет источник. */
export const SyncedFromInsideContent: Story = {
  name: "Материал из Inside Content",
  args: {
    initialPresentation: {
      ...materialAuthoringPresentation,
      draft: {
        ...materialAuthoringPresentation.draft,
        canDelete: false,
        readOnly: true,
        sourcePath: "materials/developer-pipeline.md",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("materials/developer-pipeline.md"),
    ).toBeVisible();
    await expect(canvas.getByLabelText("Название")).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Опубликовать" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeEnabled();
  },
};

export const MobileTextZoom: Story = {
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

/** Сервер не подтвердил сессию автора: страница маршрута показывает экран входа. */
export const SignedOut: Story = {
  name: "Без входа",
  render: () => (
    <MaterialAuthoringUnauthorizedState
      action={
        <MaterialAuthoringSignInActions
          returnHref={authoringMaterialsRootHref}
        />
      }
      context="editor"
    />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Нет доступа к редактору" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  },
};

/** Материала с таким адресом нет: локальные изменения не отправлялись. */
export const MaterialNotFound: Story = {
  name: "Материал не найден",
  render: () => (
    <MaterialAuthoringNotFoundState returnHref={authoringMaterialsRootHref} />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Материал не найден",
    );
    await expect(
      page.getByRole("link", { name: "Вернуться к материалам" }),
    ).toBeVisible();
  },
};

export const UnexpectedError: Story = {
  name: "Ошибка открытия редактора",
  render: () => (
    <MaterialAuthoringUnexpectedEditorState
      reference="current-material-response"
      retryHref={withAuthoringReturnHref(
        editorPath,
        authoringMaterialsRootHref,
      )}
      returnHref={authoringMaterialsRootHref}
    />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Не удалось открыть редактор",
    );
    await expect(
      page.getByText("Код обращения: current-material-response"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Повторить" })).toBeVisible();
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
    const errors = spyOn(console, "error");
    try {
      const canvas = within(canvasElement);
      const waitForEditorFocus = async () => {
        await waitFor(() =>
          expect(
            canvas.getByRole("textbox", { name: "Содержимое материала" }),
          ).toHaveFocus(),
        );
      };
      const openMenu = async () => {
        const actEnvironment: unknown = Reflect.get(
          globalThis,
          "IS_REACT_ACT_ENVIRONMENT",
        );
        // Включаем проверки React, как обвязка Storybook, и восстанавливаем среду после act.
        Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
        try {
          // Самостоятельный act владеет активацией кнопки и фокусом поиска (#609).
          await act(() => {
            canvas.getByRole("button", { name: "Добавить блок" }).click();
            return Promise.resolve();
          });
        } finally {
          Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
        }
        await expect(
          canvas.getByRole("textbox", { name: "Найти блок" }),
        ).toHaveFocus();
        return canvas.getByRole("dialog", { name: "Добавить блок" });
      };
      /**
       * Узел редактора по его разметке. Отсутствие узла — это «блок не появился», и падение обязано
       * сказать именно это: сравнение `null` с матчером сообщает лишь, что получено не HTMLElement,
       * и разбор такого падения начинается с чтения истории вместо чтения причины.
       */
      const blockNode = (selector: string, missing: string) => {
        const node = canvasElement.querySelector(selector);
        if (node === null) throw new Error(missing);
        return node;
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
        "Задание",
      ]) {
        await expect(within(menu).getByRole("button", { name })).toBeVisible();
      }

      await userEvent.click(
        within(menu).getByRole("button", { name: "Совет" }),
      );
      await waitForEditorFocus();
      await expect(
        blockNode(
          'aside[data-callout="tip"]',
          "Врезка «Совет» не появилась в редакторе",
        ),
      ).toBeVisible();

      // Фокус и DOM блока уже готовы; панель ещё следует за выбором редактора через React.
      const tip = await canvas.findByRole("button", {
        name: "Вид врезки: Совет",
      });
      await expect(tip).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(
        await canvas.findByRole("button", { name: "Вид врезки: Важно" }),
      );
      const warning = blockNode(
        'aside[data-callout="warning"]',
        "Врезка не сменила вид на «Важно»",
      );
      await expect(warning).toBeVisible();
      await expect(warning).toHaveTextContent("Важно");

      await fillByPaste(
        inputField(canvasElement, "Название врезки"),
        "Не забудьте",
      );
      await expect(
        blockNode(
          'aside[data-callout="warning"]',
          "Врезка «Важно» исчезла после ввода названия",
        ),
      ).toHaveTextContent("Не забудьте");

      menu = await openMenu();
      await userEvent.click(
        within(menu).getByRole("button", { name: "Итоги" }),
      );
      await waitForEditorFocus();
      await expect(
        blockNode(
          'section[data-material-block="takeaways"]',
          "Блок «Итоги» не появился в редакторе",
        ),
      ).toBeVisible();
      await expect(canvas.getByLabelText("Заголовок итогов")).toHaveValue(
        "Итоги урока",
      );

      menu = await openMenu();
      await userEvent.click(
        within(menu).getByRole("button", { name: "Ресурс" }),
      );
      await waitForEditorFocus();
      await fillByPaste(
        inputField(canvasElement, "Название ресурса"),
        "Спецификация",
      );
      await fillByPaste(
        inputField(canvasElement, "Адрес ресурса"),
        "https://example.com/spec",
      );
      await expect(canvas.getByLabelText("Адрес ресурса")).toHaveValue(
        "https://example.com/spec",
      );

      menu = await openMenu();
      await userEvent.click(
        within(menu).getByRole("button", { name: "Термины" }),
      );
      // Единственный набор по знаку в этой истории, и он нарочно остаётся: три подряд идущие
      // транзакции проверяют, что поле формы не теряет фокус после первого же знака.
      await userEvent.type(canvas.getByLabelText("Метка строки 1"), "ADR", {
        delay: null,
      });
      await expect(canvas.getByLabelText("Метка строки 1")).toHaveValue("ADR");
      await userEvent.click(
        canvas.getByRole("button", { name: "Добавить строку" }),
      );
      await expect(canvas.getByLabelText("Метка строки 2")).toHaveValue("");

      // Буфер обмена восстанавливает узел из разметки, поэтому название обязано быть в
      // DOM-атрибуте, а не только в тексте. Карточка ресурса и термины показывают в редакторе
      // собственную форму, поэтому их разметку проверяет не эта story, а схема документа.
      await expect(
        blockNode(
          "aside[data-callout]",
          "Врезка пропала из документа к концу истории",
        ),
      ).toHaveAttribute("data-callout-title", "Не забудьте");
      await expect(
        blockNode(
          'section[data-material-block="takeaways"]',
          "Блок «Итоги» пропал из документа к концу истории",
        ),
      ).toHaveAttribute("data-takeaways-title", "Итоги урока");

      // Панель блока принадлежит текущей врезке: вернувшись в неё, автор снова меняет её вид.
      const callout = blockNode(
        "aside[data-callout] [data-callout-body] p",
        "Тело врезки не найдено: панель блока не к чему вернуть",
      );
      await userEvent.click(callout);
      // Завершаем симуляцию выбора синхронно: обвязка клика могла уже восстановить старый курсор.
      const document = canvasElement.ownerDocument;
      const selection = document.getSelection();
      if (selection === null) throw new Error("Выбор текста недоступен");
      selection.collapse(callout, 0);
      document.dispatchEvent(new Event("selectionchange"));
      await expect(
        await canvas.findByRole("button", { name: "Вид врезки: Важно" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(canvas.getByLabelText("Название врезки")).toHaveValue(
        "Не забудьте",
      );
      await expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  },
};

/** Возврат во врезку не зависит от нативного события и восстановления старого DOM-выбора (#1191). */
export const LessonBlocksEditingDelayedSelection: Story = {
  ...LessonBlocksEditing,
  name: "Редактор · блоки урока, отложенный выбор",
  beforeEach: ({ canvasElement }) => {
    const document = canvasElement.ownerDocument;
    let previousSelection: Range | null = null;
    const isCalloutReturn = (event: MouseEvent) => {
      const callout = canvasElement.querySelector(
        "aside[data-callout] [data-callout-body] p",
      );
      return (
        event.target instanceof Node &&
        callout?.contains(event.target) === true &&
        canvasElement.querySelector(
          '[data-material-block-form="labeledList"]',
        ) !== null
      );
    };
    const rememberSelection = (event: MouseEvent) => {
      if (!isCalloutReturn(event)) return;
      const selection = document.getSelection();
      previousSelection =
        selection !== null && selection.rangeCount > 0
          ? selection.getRangeAt(0).cloneRange()
          : null;
    };
    const restoreSelection = (event: MouseEvent) => {
      if (!isCalloutReturn(event) || previousSelection === null) return;
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(previousSelection);
    };
    const delayNativeSelection = (event: Event) => {
      if (event.isTrusted) event.stopImmediatePropagation();
    };
    document.addEventListener("selectionchange", delayNativeSelection, true);
    document.addEventListener("mousedown", rememberSelection, true);
    document.addEventListener("mouseup", restoreSelection);
    return () => {
      document.removeEventListener(
        "selectionchange",
        delayNativeSelection,
        true,
      );
      document.removeEventListener("mousedown", rememberSelection, true);
      document.removeEventListener("mouseup", restoreSelection);
    };
  },
};

/** Допуск в пикселях между кнопкой «Добавить блок» и верхом блока, у которого она стоит. */
const controlsTolerance = 2;

/**
 * Сколько замеров контролов законно случается, пока автор набирает восемь знаков: перенос строки
 * меняет высоту документа, и контролы перемеряются, потому что блоки ниже сдвинулись. Пересчёт на
 * каждой транзакции дал бы по замеру на знак.
 */
const remeasuresAllowedWhileTyping = 2;

/** Экземпляр Tiptap, который редактор кладёт на свой DOM-узел. */
interface TiptapEditorInstance {
  setOptions(options: object): void;
}

function tiptapEditor(canvasElement: HTMLElement): TiptapEditorInstance {
  const dom = canvasElement.querySelector(".ProseMirror");
  const editor: unknown = dom === null ? undefined : Reflect.get(dom, "editor");
  if (!isTiptapEditor(editor)) {
    throw new Error(
      "У документа нет экземпляра Tiptap: не к чему подключить счётчик перерисовок",
    );
  }
  return editor;
}

function isTiptapEditor(value: unknown): value is TiptapEditorInstance {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "setOptions") === "function"
  );
}

/**
 * Контролы блока встают у блока под курсором, стоят на месте, пока автор печатает, и следуют за
 * новым блоком и за указателем. Знак при этом не стоит ни перерисовки редактора, ни замера контролов.
 *
 * До #602 каждый знак перерисовывал редактор дважды — сам по себе (`shouldRerenderOnTransaction`)
 * и вместе со страницей, которая кладёт черновик в состояние для автосохранения, — и заново мерил
 * контролы на каждой транзакции. История идёт на той же фикстуре, что и страница, и падает, если
 * вернуть любое из трёх.
 */
async function expectBlockControlsWithoutKeystrokeCost(
  canvasElement: HTMLElement,
) {
  const canvas = within(canvasElement);
  const plus = canvas.getByRole("button", { name: "Добавить блок" });
  const surface = plus.parentElement;
  if (!(surface instanceof HTMLElement)) {
    throw new Error(
      "У кнопки «Добавить блок» нет поверхности, от которой считается её место",
    );
  }
  const editorWindow = surface.parentElement;
  if (!(editorWindow instanceof HTMLElement)) {
    throw new Error("Поверхность редактора стоит вне окна редактора");
  }
  const editor = tiptapEditor(canvasElement);
  const block = (index: number) => {
    const node = canvasElement.querySelectorAll(".ProseMirror > *")[index];
    if (!(node instanceof HTMLElement)) {
      throw new Error(`В документе нет блока ${String(index + 1)}`);
    }
    return node;
  };
  const controlsOffset = (target: HTMLElement) =>
    Math.abs(
      plus.getBoundingClientRect().top - target.getBoundingClientRect().top,
    );
  const expectControlsAt = (target: HTMLElement, message: string) =>
    waitFor(() =>
      expect(controlsOffset(target), message).toBeLessThan(controlsTolerance),
    );
  const nextFrame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );

  const paragraph = block(2);
  await userEvent.click(paragraph);
  await expectControlsAt(
    paragraph,
    "Кнопка «Добавить блок» не встала у абзаца под курсором",
  );
  // Первый знак переводит черновик в «Не сохранено»: подпись в подвале редактора меняется, и эта
  // перерисовка законна. Считать начинаем после неё.
  await userEvent.keyboard(" и");
  await expect(
    await within(editorWindow).findByText("Не сохранено"),
  ).toBeVisible();
  await nextFrame();

  // `useEditor` отдаёт Tiptap свежие настройки после каждого рендера редактора: вызов — это рендер.
  const renders = spyOn(editor, "setOptions");
  // ProseMirror на каждом знаке прокручивает курсор в видимую область и для этого читает размеры
  // каждого предка, поверхности и окна редактора поровну. Контролы читают только поверхность,
  // поэтому их замеры — это разница между двумя счётчиками.
  const surfaceReads = spyOn(surface, "getBoundingClientRect");
  const windowReads = spyOn(editorWindow, "getBoundingClientRect");
  try {
    // Кадр после каждого знака: замер, назначенный на кадр, успевает выполниться и попасть в счёт.
    for (const key of " её цена") {
      await userEvent.keyboard(key);
      await nextFrame();
    }
    await expect(paragraph).toHaveTextContent("и её цена");
    // Сначала замеры: пересчёт контролов тоже может перерисовать редактор, и проверка рендеров
    // назвала бы его не той причиной.
    await expect(
      surfaceReads.mock.calls.length - windowReads.mock.calls.length,
      "Набор в абзаце заново мерил положение контролов: пересчёт снова идёт на каждой транзакции",
    ).toBeLessThanOrEqual(remeasuresAllowedWhileTyping);
    await expect(
      renders,
      "Набор в абзаце перерисовал редактор: он снова перерисовывается на каждой транзакции или вместе со страницей",
    ).not.toHaveBeenCalled();
    await expect(
      controlsOffset(paragraph),
      "Кнопка «Добавить блок» сдвинулась, пока автор печатал в том же абзаце",
    ).toBeLessThan(controlsTolerance);
    // Счётчик рендеров должен что-то видеть: раскрытие на весь экран перерисовывает редактор.
    await userEvent.click(
      canvas.getByRole("button", { name: "На весь экран" }),
    );
    await expect(
      renders,
      "Раскрытие редактора не дошло до Tiptap: счётчик перерисовок больше ничего не видит",
    ).toHaveBeenCalled();
  } finally {
    renders.mockRestore();
    surfaceReads.mockRestore();
    windowReads.mockRestore();
  }
  await userEvent.click(
    canvas.getByRole("button", { name: "Свернуть редактор" }),
  );
  await expectControlsAt(
    paragraph,
    "Кнопка «Добавить блок» не вернулась к абзацу после свёртывания",
  );

  // Кнопка свёртывания забрала фокус: клик возвращает курсор в абзац, Enter делит его надвое.
  await userEvent.click(paragraph);
  await userEvent.keyboard("{Enter}");
  const created = block(3);
  await expectControlsAt(
    created,
    "Кнопка «Добавить блок» не перешла к новому абзацу",
  );

  const first = block(0);
  await userEvent.hover(first);
  await expectControlsAt(
    first,
    "Кнопка «Добавить блок» не перешла к блоку под указателем",
  );
}

export const BlockControlsTyping: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Редактор · контролы блока",
  play: async ({ canvasElement }) => {
    await expectBlockControlsWithoutKeystrokeCost(canvasElement);
  },
};

export const BlockControlsTypingMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Редактор · контролы блока, мобильный",
  play: async ({ canvasElement }) => {
    await expectBlockControlsWithoutKeystrokeCost(canvasElement);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const VariantStepEditor: Story = {
  args: { initialPresentation: variantStepAuthoringPresentation },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Вариантный шаг · редактор",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Имя режима автор читает на самой ветке: иначе две ветки неразличимы.
    await expect(canvas.getByText("Учебный проект")).toBeVisible();
    await expect(canvas.getByText("Свой проект")).toBeVisible();
    await expect(
      canvas.getByText(
        "Учебный проект: пройдите шаг на подготовленном репозитории.",
      ),
    ).toBeVisible();
    // Сложность и обещание урока автор заполняет там же, где остальные параметры.
    await expect(canvas.getByText("Сложность")).toBeVisible();
    await expect(canvas.getByText("Чему научишься")).toBeVisible();
    await expect(canvas.getByLabelText("Пункт 1")).toBeVisible();
  },
};

export const VariantStepEditorMobile: Story = {
  args: { initialPresentation: variantStepAuthoringPresentation },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Вариантный шаг · мобильный",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Свой проект")).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const SearchableSeries: Story = {
  name: "Продукты · поиск и продолжение списка",
  args: {
    initialPresentation: {
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
    const series = within(canvas.getByLabelText("Выбор продуктов"));
    await expect(series.getAllByRole("checkbox")).toHaveLength(20);
    const more = series.getByRole("button", { name: "Показать ещё" });
    more.focus();
    await userEvent.keyboard("{Enter}");
    await expect(series.getAllByRole("checkbox").length).toBeGreaterThan(20);
    await userEvent.type(
      canvas.getByLabelText("Поиск продуктов"),
      "Руководство 45",
      { delay: null },
    );
    await expect(series.getAllByRole("checkbox")).toHaveLength(1);
    await expect(
      series.getByRole("checkbox", { name: "Руководство 45" }),
    ).toBeVisible();
    const page = routeContent(canvasElement);
    await expect(page.getAllByText("Теги", { exact: true })).toHaveLength(1);
    await expect(page.getAllByText("Продукты", { exact: true })).toHaveLength(
      1,
    );
  },
};

export const ImageAttachment: Story = {
  name: "Вложенное изображение · форма вложения",
  args: { initialPresentation: imageAttachmentPresentation },
  play: async ({ canvasElement }) => {
    const form = within(imageAttachment(canvasElement));
    // The description is a field of the attachment form: visible and writable as it stands.
    const description = form.getByLabelText("Описание изображения");
    await expect(description).toBeVisible();
    await userEvent.type(description, "Путь задачи от issue до owner GO", {
      delay: null,
    });
    await expect(description).toHaveValue("Путь задачи от issue до owner GO");
    await expect(form.getByLabelText("Подпись изображения")).toBeVisible();
    await expect(form.getByLabelText("Размер изображения")).toBeVisible();
  },
};

export const ImageAttachmentMobile: Story = {
  args: { initialPresentation: imageAttachmentPresentation },
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

/**
 * Длинное значение попадает в поле одной вставкой, а не набором по знаку.
 *
 * Каждое нажатие в редакторе — это транзакция, редактор пересобирается на каждой транзакции
 * (`material-document-editor.client.tsx`, `shouldRerenderOnTransaction`) и заново считает
 * положение своих контролов через `getBoundingClientRect` и `coordsAtPos`
 * (`use-material-block-controls.ts`). На машине разработчика знак стоит около 7 мс, на раннере —
 * около 140 мс: там браузерные воркеры делят ядра, и в измеренном прогоне 263,75 с тестового
 * времени уложились в 90,79 с.
 *
 * Вставка — настоящее действие автора и тот же путь обработчика: оба события заканчиваются одним
 * `input`. Набор по знаку остаётся на короткой метке строки, где он дёшев и где проверяется, что
 * поле переживает подряд идущие транзакции.
 */
async function fillByPaste(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await userEvent.click(field);
  await userEvent.paste(value);
  // Вставка — это действие, а не присваивание: если значение не дошло, падение обязано сказать
  // именно это, а не показывать разницу двух строк без объяснения.
  if (field.value !== value) {
    throw new Error(
      `Поле «${field.getAttribute("aria-label") ?? ""}» не приняло вставленное значение «${value}»: в нём осталось «${field.value}»`,
    );
  }
}

/** Поле ввода по его подписи. Отсутствие поля — это «поля нет», а не «получен не тот элемент». */
function inputField(canvasElement: HTMLElement, label: string) {
  const field = within(canvasElement).getByLabelText(label);
  if (
    !(field instanceof HTMLInputElement) &&
    !(field instanceof HTMLTextAreaElement)
  ) {
    throw new Error(`Элемент с подписью «${label}» не является полем ввода`);
  }
  return field;
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

/** Real page and real children; spies count renders without replacing their implementations. */
export const WorkspaceTyping: Story = {
  name: "Редактор · набор документа не перерисовывает соседние панели",
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  decorators: [
    (Story) => (
      <Profiler
        id="material-page"
        onRender={(_id, _phase, duration) => {
          typingProfile(duration);
        }}
      >
        <Story />
      </Profiler>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const paragraph = canvasElement.querySelector(".ProseMirror > p");
    if (!(paragraph instanceof HTMLElement))
      throw new Error("No editable paragraph");
    await userEvent.click(paragraph);
    const parts = [
      MaterialMetadataPanel,
      ContentCoverEditor,
      MaterialVideoAuthoring,
      MaterialAuthoringHeader,
    ];
    for (const part of parts) {
      await expect(mocked(part)).toHaveBeenCalled();
      mocked(part).mockClear();
    }
    await userEvent.keyboard(" и");
    await expect(
      (await canvas.findAllByText("Не сохранено")).length,
    ).toBeGreaterThan(0);
    for (const part of parts.slice(0, 3))
      await expect(
        mocked(part),
        "First document edit rerendered an unrelated panel",
      ).not.toHaveBeenCalled();
    await expect(mocked(MaterialAuthoringHeader)).toHaveBeenCalledTimes(1);
    mocked(MaterialAuthoringHeader).mockClear();
    typingProfile.mockClear();
    const text = " текст документа без лишних рендеров";
    const start = performance.now();
    await userEvent.keyboard(text);
    const elapsed = performance.now() - start;
    const react = typingProfile.mock.calls.reduce(
      (sum, [duration]) => sum + duration,
      0,
    );
    console.info(
      "[646-typing]",
      JSON.stringify({
        characters: text.length,
        millisecondsPerCharacter: elapsed / text.length,
        reactMilliseconds: react,
        commits: typingProfile.mock.calls.length,
        renders: parts.map((part) => mocked(part).mock.calls.length),
      }),
    );
    await expect(paragraph).toHaveTextContent(text.trim());
    for (const part of parts)
      await expect(
        mocked(part),
        "Typing rerendered a part unrelated to the document",
      ).not.toHaveBeenCalled();
    await expect(
      (await canvas.findAllByText("Сохранено сейчас")).length,
    ).toBeGreaterThan(0);
    await expect(savedField("document")).toContain(text.trim());
    // Positive control: metadata changes still reach every dependent part and the next save.
    const title = canvas.getByLabelText("Название");
    await userEvent.type(title, "!", { delay: null });
    await expect(
      canvas.getByRole("heading", { name: "Developer Pipeline без магии!" }),
    ).toBeVisible();
    for (const part of [
      MaterialMetadataPanel,
      ContentCoverEditor,
      MaterialAuthoringHeader,
    ])
      await expect(mocked(part)).toHaveBeenCalled();
    await expect(mocked(MaterialVideoAuthoring)).not.toHaveBeenCalled();
    await expect(
      (await canvas.findAllByText("Сохранено сейчас")).length,
    ).toBeGreaterThan(0);
    await expect(savedField("title")).toBe("Developer Pipeline без магии!");
    await expect(savedField("document")).toContain(text.trim());
  },
};

export const SavedAfterActivity: Story = {
  render: (args) => (
    <AutosaveActivity>
      <MaterialAuthoringPageClient {...args} />
    </AutosaveActivity>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", { name: "Название" }),
          " — правка",
        );
      },
      /Сохранено сейчас/u,
    );
  },
};

export const FailedAfterActivity: Story = {
  ...SavedAfterActivity,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", { name: "Название" }),
          " — отказ",
        );
      },
      "Повторить",
      () => new Response(null, { status: 503 }),
    );
    await expect(
      canvas.queryByText(/Сохранено сейчас/u),
    ).not.toBeInTheDocument();
  },
};

export const NewerEditAfterActivity: Story = {
  ...SavedAfterActivity,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = canvas.getByRole("textbox", { name: "Название" });
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.clear(title);
        await userEvent.type(title, "Первая правка");
      },
      /Сохранено сейчас/u,
      undefined,
      async () => {
        await userEvent.clear(title);
        await userEvent.type(title, "Новая правка");
      },
    );
    await expect(title).toHaveValue("Новая правка");
    await expect(savedField("title")).toBe("Новая правка");
  },
};

export const ImportedCollapsibleAdvice: Story = {
  args: {
    initialPresentation: {
      ...materialAuthoringPresentation,
      draft: {
        ...materialAuthoringPresentation.draft,
        document: {
          type: "doc",
          content: [
            {
              type: "callout",
              attrs: {
                kind: "tip",
                title: "Мой совет",
                collapse: "collapsed",
                nodeId: "94000000-0000-4000-8000-000000000301",
              },
              content: [
                {
                  type: "paragraph",
                  attrs: { nodeId: "94000000-0000-4000-8000-000000000302" },
                  content: [
                    { type: "text", text: "Тело импортированного совета" },
                  ],
                },
              ],
            },
            {
              type: "callout",
              attrs: {
                kind: "tip",
                title: "Открытый совет",
                collapse: "expanded",
                nodeId: "94000000-0000-4000-8000-000000000303",
              },
              content: [
                {
                  type: "paragraph",
                  attrs: { nodeId: "94000000-0000-4000-8000-000000000304" },
                  content: [{ type: "text", text: "Открытое тело" }],
                },
              ],
            },
          ],
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Тело импортированного совета"),
    ).toBeVisible();
    const collapsed = canvasElement.querySelector(
      'aside[data-callout-collapse="collapsed"]',
    );
    const expanded = canvasElement.querySelector(
      'aside[data-callout-collapse="expanded"]',
    );
    await expect(collapsed).not.toBeNull();
    await expect(expanded).not.toBeNull();
    await userEvent.type(canvas.getByLabelText("Название"), "!", {
      delay: null,
    });
    await expect(
      (await canvas.findAllByText(/Сохранено сейчас/u)).length,
    ).toBeGreaterThan(0);
    const saved = savedField("document");
    if (typeof saved !== "string") throw new Error("Autosave must send a body");
    await expect(saved).toContain('"collapse":"collapsed"');
    await expect(saved).toContain('"collapse":"expanded"');
    await expect(saved).toContain("Тело импортированного совета");
  },
};
