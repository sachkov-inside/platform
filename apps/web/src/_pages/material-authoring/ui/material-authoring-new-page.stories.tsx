import {
  AutosaveActivity,
  autosaveWhileHidden,
} from "@/storybook/autosave-activity";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, within } from "storybook/test";

import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import { MaterialAuthoringUnexpectedEditorState } from "@/widgets/material-authoring/route-states";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import {
  createdReply,
  emptyMaterialAuthoringPresentation,
  materialBeforeRender,
  materialId,
  materialRequests,
  savedReply,
} from "./material-authoring.fixtures";
import { MaterialAuthoringPageClient } from "./material-authoring-page.client";

const environment = authoringPageEnvironment("/authoring/materials/new");

/**
 * Созданный черновик получает свой адрес через `history.replaceState`, не перезагружая редактор.
 * В Storybook адрес холста трогать нельзя, поэтому история перехватывает вызов и проверяет его.
 */
/** Адреса, которые страница поставила через `history.replaceState`. */
const addressChanges = fn((_url: string | URL | null | undefined) => undefined);

function keepCanvasAddress() {
  addressChanges.mockClear();
  const replaceState = spyOn(window.history, "replaceState");
  replaceState.mockImplementation((_data, _unused, url) => {
    addressChanges(url);
  });
  return () => {
    replaceState.mockRestore();
  };
}

const meta = {
  ...environment,
  beforeEach: [
    environment.beforeEach,
    keepCanvasAddress,
    // Созданный черновик меняет своё состояние, и следующая пауза сохраняет его как обычный.
    materialBeforeRender({ POST: createdReply, PUT: savedReply() }),
  ],
  args: {
    initialPresentation: emptyMaterialAuthoringPresentation,
    returnHref: authoringMaterialsRootHref,
  },
  component: MaterialAuthoringPageClient,
  parameters: {
    ...environment.parameters,
    controls: { exclude: ["initialPresentation"] },
    docs: {
      description: {
        component:
          "Новый материал на маршруте `/authoring/materials/new`: пустой черновик создаётся первым " +
          "автосохранением после названия. Ответ создания подменяет BFF `/api/authoring/materials`.",
      },
    },
  },
  title: "Pages/Authoring/New material",
} satisfies Meta<typeof MaterialAuthoringPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  await expect(
    canvasElement.ownerDocument.documentElement.scrollWidth,
  ).toBeLessThanOrEqual(
    canvasElement.ownerDocument.documentElement.clientWidth + 1,
  );
}

export const EmptyNewDraft: Story = {
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
    await expect(
      canvas.getByText(
        "Сначала создайте черновик, затем добавляйте файлы и изображения.",
      ),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const EmptyNewDraftDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Новый черновик · широкий экран",
};

/** Название создаёт черновик: адрес меняется на адрес материала, редактор остаётся на месте. */
export const DraftCreated: Story = {
  name: "Черновик создан",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const started = performance.now();
    const installedFetch = window.fetch;
    await userEvent.type(canvas.getByLabelText("Название"), "Первый релиз", {
      delay: null,
    });
    const typed = performance.now();
    try {
      await expect(
        (await canvas.findAllByText(/Сохранено сейчас/u, {}, { timeout: 4000 }))
          .length,
      ).toBeGreaterThan(0);
    } catch (error) {
      try {
        const title = canvas.queryByLabelText("Название");
        console.error("[DraftCreated failure]", {
          typedMs: typed - started,
          waitedMs: performance.now() - typed,
          fetchIntact: window.fetch === installedFetch,
          connected: canvasElement.isConnected,
          title: title instanceof HTMLInputElement ? title.value : null,
          statuses: canvas
            .queryAllByRole("status")
            .map((node) => node.textContent),
          alerts: canvas
            .queryAllByRole("alert")
            .map((node) => node.textContent),
          requests: materialRequests.mock.calls.map(([method, form]) => ({
            method,
            title: form?.get("title"),
          })),
          addressChanges: addressChanges.mock.calls,
        });
      } catch {
        // Keep the saved-state assertion even if collecting diagnostics fails.
      }
      throw error;
    }
    await expect(canvas.getAllByText(/Черновик/u).length).toBeGreaterThan(0);
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeEnabled();
    await expect(materialRequests).toHaveBeenCalledWith(
      "POST",
      expect.any(FormData),
    );
    await expect(addressChanges).toHaveBeenCalledWith(
      `/authoring/materials/${materialId}?from=%2Fauthoring%2Fmaterials`,
    );
  },
};

/** Сервер отклонил поля черновика: страница называет их, не создавая материал. */
export const CreateRejected: Story = {
  name: "Черновик не создан: поля отклонены",
  beforeEach: materialBeforeRender({
    POST: {
      issues: [{ message: "Название слишком длинное.", path: "/title" }],
      kind: "invalid_input",
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Название"), "Первый релиз", {
      delay: null,
    });
    await expect(
      await canvas.findByText("Проверьте перед сохранением"),
    ).toBeVisible();
    await expect(canvas.getByText("Название слишком длинное.")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Предпросмотр" }),
    ).toBeDisabled();
  },
};

/** Сессия не подтверждена: страница передаёт редактору запрет, и он показывает экран входа. */
export const SignedOut: Story = {
  name: "Без входа",
  args: {
    initialPresentation: {
      ...emptyMaterialAuthoringPresentation,
      availableFormats: [],
      availableSeries: [],
      availableTags: [],
      availableTopics: [],
      authorization: { kind: "unauthorized" },
    },
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Нет доступа к редактору" }),
    ).toBeVisible();
    await expect(page.queryByRole("textbox")).not.toBeInTheDocument();
  },
};

export const UnexpectedError: Story = {
  name: "Ошибка открытия редактора",
  render: () => (
    <MaterialAuthoringUnexpectedEditorState
      reference="identity-session"
      retryHref="/authoring/materials/new?from=%2Fauthoring%2Fmaterials"
      returnHref={authoringMaterialsRootHref}
    />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Не удалось открыть редактор",
    );
    await expect(
      page.getByText("Код обращения: identity-session"),
    ).toBeVisible();
  },
};

export const CreatedAfterActivity: Story = {
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
          "Черновик после возврата",
        );
      },
      /Сохранено сейчас/u,
      undefined,
      undefined,
      2,
    );
    await expect(addressChanges).toHaveBeenCalledOnce();
    // Creation changes canDelete in the draft; its existing queue follows with one PUT.
    await expect(materialRequests.mock.calls.map(([method]) => method)).toEqual(
      ["POST", "PUT"],
    );
  },
};
export const FailedAfterActivity: Story = {
  ...CreatedAfterActivity,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", { name: "Название" }),
          "Черновик с отказом",
        );
      },
      "Повторить",
      () => new Response(null, { status: 503 }),
    );
    await expect(addressChanges).not.toHaveBeenCalled();
    await expect(
      canvas.queryByText(/Сохранено сейчас/u),
    ).not.toBeInTheDocument();
  },
};
