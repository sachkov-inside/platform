import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  authoringMaterialPreviewHref,
  authoringMaterialsRootHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";
import { MaterialCurrentPreview } from "@/widgets/material-authoring/preview";
import {
  MaterialAuthoringPreviewNotFoundState,
  MaterialAuthoringPreviewUnauthorizedState,
  MaterialAuthoringUnexpectedPreviewState,
} from "@/widgets/material-authoring/route-states";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  emptyLessonBlocks,
  longLessonBlocks,
  materialId,
  materialPreview,
  materialPreviewRoute,
} from "./material-authoring.fixtures";

const previewPath = `/authoring/materials/${materialId}/preview`;
const editorHref = withAuthoringReturnHref(
  `/authoring/materials/${materialId}`,
  authoringMaterialsRootHref,
);
const environment = authoringPageEnvironment(previewPath);

const meta = {
  ...environment,
  args: {
    editorHref,
    materialsHref: authoringMaterialsRootHref,
    preview: { ...materialPreview, video: { kind: "none" } },
    route: null,
  },
  component: MaterialCurrentPreview,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Предпросмотр сохранённой версии на маршруте `/authoring/materials/<id>/preview`: материал " +
          "так, как его увидит читатель, маршрут руководства глазами автора и состояние видео.",
      },
    },
  },
  title: "Pages/Authoring/Material preview",
} satisfies Meta<typeof MaterialCurrentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  await expect(
    canvasElement.ownerDocument.documentElement.scrollWidth,
  ).toBeLessThanOrEqual(
    canvasElement.ownerDocument.documentElement.clientWidth + 1,
  );
}

/** Материал вне руководства: оболочка отмечает «Предпросмотр черновика», маршрута нет. */
export const Draft: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Черновик · широкий экран",
  play: async ({ canvasElement }) => {
    const shell = within(canvasElement);
    await expect(
      shell.getByText("Предпросмотр черновика").closest("[aria-current]"),
    ).toHaveAttribute("aria-current", "page");
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Предпросмотр материала" }),
    ).toBeVisible();
    await expect(page.getByText("черновик · версия 7")).toBeVisible();
    await expect(
      canvasElement.querySelector("[data-preview-status-banner]"),
    ).toHaveTextContent("Сохранённый черновик. Материал ещё не опубликован.");
    await expect(
      page.getByRole("heading", { name: "Developer Pipeline без магии" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Таблица в предпросмотре" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Схема Developer Pipeline" }),
    ).toBeVisible();
    await expect(page.getByText("Checklist проверки")).toBeVisible();
    await expect(
      canvasElement.querySelector("[data-preview-video]"),
    ).toHaveTextContent("Видео к материалу не прикреплено.");
    await expect(
      page.getAllByRole("link", { name: "Вернуться в редактор" }),
    ).toHaveLength(2);
  },
};

export const DraftMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Черновик · мобильный",
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Предпросмотр материала",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Published: Story = {
  name: "Опубликованный материал",
  args: { preview: { ...materialPreview, publicationState: "published" } },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("[data-preview-status-banner]"),
    ).toHaveTextContent("Материал опубликован и доступен читателям.");
  },
};

/** Вариантный шаг показан как у читателя: ветка режима по умолчанию и переключатель. */
export const VariantStep: Story = {
  name: "Вариантный шаг",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText(
        "Учебный проект: пройдите шаг на подготовленном репозитории.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Свой проект: примените шаг к своему репозиторию."),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Показать вариант «Свой проект»" }),
    ).toBeVisible();
  },
};

/** Длинное содержимое на самой узкой ширине: переносы без прокрутки вбок. */
export const LongBlocksNarrow: Story = {
  args: { preview: { ...materialPreview, blocks: longLessonBlocks } },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  name: "Длинные блоки · 320",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("button", { name: /Копировать/u }),
    ).toBeVisible();
    await expect(page.getByLabelText(/^Важно/u)).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

/** Автор вставил блоки и ещё не написал содержимое: пустые блоки не ломают страницу. */
export const EmptyBlocks: Story = {
  args: { preview: { ...materialPreview, blocks: emptyLessonBlocks } },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Пустые блоки",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.queryByRole("link", { name: /Открыть/u }),
    ).not.toBeInTheDocument();
    await expect(page.getByLabelText("Примечание")).toBeVisible();
    await expect(page.getByRole("region", { name: "Итоги" })).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const GuideRoute: Story = {
  args: {
    preview: {
      ...materialPreview,
      video: { kind: "attached", ready: true, title: "Запись урока" },
    },
    route: materialPreviewRoute,
  },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Маршрут руководства · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const route = within(
      page.getByRole("navigation", {
        name: "Маршрут руководства «Inside AI Engineering»",
      }),
    );
    await expect(
      route.getByText(/Глава 1\. Harness и первые уроки · материал 3 из 5/u),
    ).toBeVisible();
    await expect(
      route.getByRole("link", {
        name: "Назад: Подготовка окружения и первый запуск агента",
      }),
    ).toHaveAttribute("href", materialPreviewRoute.previous.href);
    await expect(
      route.getByRole("link", { name: "Дальше: Проверка результата" }),
    ).toHaveAttribute("href", materialPreviewRoute.next.href);
    await userEvent.click(route.getByText("Все материалы руководства"));
    // Текущий материал — не ссылка, а отмеченная строка; пустая глава остаётся в списке.
    await expect(
      route.getByText("Developer Pipeline без магии").closest("[aria-current]"),
    ).toHaveAttribute("aria-current", "page");
    await expect(route.getByText("В главе пока нет материалов.")).toBeVisible();
    await expect(route.getByText("Вне глав")).toBeVisible();
    await expect(
      canvasElement.querySelector("[data-preview-video]"),
    ).toHaveTextContent(
      "Видео «Запись урока» готово. Плеер появится на странице урока после публикации.",
    );
    await expect(
      page.getByRole("navigation", { name: "Соседние материалы руководства" }),
    ).toBeVisible();
  },
};

export const GuideRouteMobile: Story = {
  args: { route: materialPreviewRoute },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Маршрут руководства · мобильный",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(page.getByText("Все материалы руководства"));
    await expect(page.getByText("Словарь курса")).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const GuideRouteFirstMaterial: Story = {
  args: {
    route: {
      ...materialPreviewRoute,
      otherGuides: [
        { href: materialPreviewRoute.next.href, name: "AI-first процесс" },
      ],
      position: 1,
      previous: null,
    },
  },
  name: "Маршрут руководства · первый материал",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("button", { name: "Назад" })).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "AI-first процесс" }),
    ).toBeVisible();
  },
};

export const GuideRouteUnavailable: Story = {
  args: {
    preview: { ...materialPreview, video: { kind: "unavailable" } },
    route: { kind: "unavailable", reference: "series-order-response" },
  },
  name: "Маршрут руководства недоступен",
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector('[data-preview-route="unavailable"]'),
    ).toHaveTextContent(
      "Не удалось показать маршрут руководства. Сам материал показан ниже. Код обращения: series-order-response",
    );
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Developer Pipeline без магии",
      }),
    ).toBeVisible();
  },
};

export const SignedOut: Story = {
  name: "Нет доступа к предпросмотру",
  render: () => (
    <MaterialAuthoringPreviewUnauthorizedState
      returnHref={authoringMaterialsRootHref}
    />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Нет доступа к предпросмотру",
    );
    await expect(
      page.getByRole("link", { name: "Вернуться к материалам" }),
    ).toBeVisible();
  },
};

export const NotFound: Story = {
  name: "Предпросмотр не найден",
  render: () => (
    <MaterialAuthoringPreviewNotFoundState
      editorHref={editorHref}
      returnHref={authoringMaterialsRootHref}
    />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Предпросмотр не найден",
    );
    await expect(
      page.queryByRole("link", { name: "Повторить" }),
    ).not.toBeInTheDocument();
  },
};

export const UnexpectedError: Story = {
  name: "Ошибка предпросмотра",
  render: () => (
    <MaterialAuthoringUnexpectedPreviewState
      editorHref={editorHref}
      reference="preview_unavailable"
      retryHref={authoringMaterialPreviewHref(
        materialId,
        authoringMaterialsRootHref,
      )}
      returnHref={authoringMaterialsRootHref}
    />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Не удалось открыть предпросмотр",
    );
    await expect(
      page.getByText("Код обращения: preview_unavailable"),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Повторить" })).toBeVisible();
  },
};
