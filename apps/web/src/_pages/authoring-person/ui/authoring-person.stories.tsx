import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { AuthoringPersonLoading } from "@/_pages/authoring-person/ui/authoring-person-loading";
import { AuthoringPersonPage } from "@/_pages/authoring-person/ui/authoring-person-page";
import { AuthoringPersonView } from "@/_pages/authoring-person/ui/authoring-person-view.client";
import { getQueryClient } from "@/shared/api/query-client";
import {
  authoringPeopleHref,
  authoringPersonHref,
} from "@/shared/routing/authoring";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import { z } from "zod";

import {
  fetchBeforeRender,
  type MutationFetch,
} from "@/storybook/mutation-mock";
import {
  accessFetch,
  annaCard,
  cardState,
  newcomerCard,
  storyAnnaId,
  storyProducts,
  unavailableBlocksCard,
} from "@/storybook/people.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

const [ai, architecture, practice] = storyProducts;
/** `parameters.access` story: как отвечают выбор продуктов и команды доступа. */
const accessOptionsSchema = z
  .object({
    catalog: z.enum(["ready", "unavailable"]).optional(),
    community: z.enum(["closes", "remains"]).optional(),
    preview: z.number().optional(),
    reply: z.enum(["ok", "revision_conflict", "operation_conflict"]).optional(),
  })
  .strict();
const refreshed = fn(() => Promise.resolve());
const retried = fn();
const written = fn();
const environment = authoringPageEnvironment(authoringPersonHref(storyAnnaId));

const meta = {
  ...environment,
  args: {
    onRefresh: refreshed,
    onRetry: retried,
    onWritten: written,
    state: cardState(annaCard),
  },
  beforeEach: ({ parameters }) => {
    refreshed.mockClear();
    retried.mockClear();
    written.mockClear();
    getQueryClient().removeQueries({ queryKey: ["authoring"] });
    const restoreEnvironment = environment.beforeEach();
    // Ответы BFF ставятся до первого рендера: каталог читается сразу при открытии карточки.
    const options = accessOptionsSchema.safeParse(parameters["access"]);
    const restoreFetch = fetchBeforeRender(
      accessFetch(options.success ? options.data : {}),
    )();
    return () => {
      restoreFetch();
      restoreEnvironment?.();
    };
  },
  component: AuthoringPersonView,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Карточка человека (#1721): шапка с «Выдать продукт», одна страница с якорями (решение 10). Каждый блок отвечает сам; действия с доступом вызывают Product Access и показывают его ответ. Storybook передаёт состояние карточки напрямую, а команды доступа отвечает подмена BFF.",
      },
    },
  },
  title: "Pages/Authoring/Карточка человека",
} satisfies Meta<typeof AuthoringPersonView>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = () => within(document.body);

function panel(canvasElement: HTMLElement, name: string) {
  return within(routeContent(canvasElement).getByRole("article", { name }));
}

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  await waitFor(() => expect(root.scrollWidth).toBe(root.clientWidth));
}

export const AllBlocks: Story = {
  globals: desktop.globals,
  name: "Все блоки · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Анна Петрова" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "@anna_petrova (открыть в Telegram)" }),
    ).toHaveAttribute("href", "https://t.me/anna_petrova");
    await expect(page.getByText("anna.petrova@example.test")).toBeVisible();
    await expect(page.getByText("ID 96000000")).toBeVisible();
    await expect(
      within(page.getByRole("navigation", { name: "Разделы карточки" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Продукты и история",
      "Оплаты и ссылки",
      "Обучение",
      "Telegram",
      "Списки ожидания",
    ]);
    const revoked = panel(canvasElement, architecture.name);
    await expect(revoked.getByText("Доступ отозван")).toBeVisible();
    await expect(
      revoked.getByRole("button", {
        name: `Восстановить доступ к «${architecture.name}»`,
      }),
    ).toBeVisible();
    await expect(
      revoked.getByText("Автор неизвестен", { exact: false }),
    ).toBeVisible();
    await expect(
      panel(canvasElement, ai.name).getAllByText("Покупка", { exact: true }),
    ).toHaveLength(2);
    await expect(page.getAllByText(/^14\s990\s₽$/u)[0]).toBeVisible();
    await expect(
      page.getByText(`Ссылка на оплату «${ai.name}»`, { exact: false }),
    ).toBeVisible();
    // Строка оплаты ведёт на страницу платежа, а «Все оплаты» в список с фильтром по человеку.
    const payments = within(
      page.getByRole("region", { name: "Оплаты и ссылки" }),
    );
    await expect(
      payments
        .getAllByRole("link")
        .some(
          (link) =>
            link.getAttribute("href") ===
            "/authoring/sales/payments/96000000-0000-4000-8000-000000000501",
        ),
    ).toBe(true);
    await expect(
      payments.getByRole("link", { name: "Все оплаты" }),
    ).toHaveAttribute(
      "href",
      `/authoring/sales/payments?person=${storyAnnaId}`,
    );
    await expect(page.getByText("Прочитано 12 из 40 · 30%")).toBeVisible();
    await expect(
      page.getByText("3 сдачи, последняя 25 окт. 2026, 14:05"),
    ).toBeVisible();
    await expect(page.getByText("Отказался через /stop")).toBeVisible();
    await expect(page.getAllByText("Поток весна 2027")[0]).toBeVisible();
    // Email не стоит рядом со сдачами, UUID не служит названием.
    await expect(page.queryByText(storyAnnaId)).toBeNull();
  },
};

export const AllBlocksMobile: Story = {
  ...AllBlocks,
  globals: mobile.globals,
  name: "Все блоки · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("button", {
        name: "Выдать продукт",
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Все оплаты" })).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const UnavailableBlocks: Story = {
  args: { state: cardState(unavailableBlocksCard) },
  globals: desktop.globals,
  name: "Блоки не ответили, сдачи закрыты правом",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText(
        "Оплаты сейчас не удалось загрузить. Остальная карточка актуальна.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Сдачи видит аккаунт с правом управлять материалами."),
    ).toBeVisible();
    await expect(
      panel(canvasElement, ai.name).getByText("Доступ открыт"),
    ).toBeVisible();
    const [retry] = page.getAllByRole("button", { name: "Повторить" });
    if (retry === undefined) throw new Error("Нет кнопки «Повторить»");
    await userEvent.click(retry);
    await expect(retried).toHaveBeenCalledTimes(1);
  },
};

export const UnavailableBlocksMobile: Story = {
  ...UnavailableBlocks,
  globals: mobile.globals,
  name: "Блоки не ответили · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Newcomer: Story = {
  args: { state: cardState(newcomerCard) },
  globals: desktop.globals,
  name: "Новый человек: без продуктов, Telegram неизвестен",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "buyer.only@example.test" }),
    ).toBeVisible();
    await expect(
      page.getByText("У человека пока нет продуктов.", { exact: false }),
    ).toBeVisible();
    await expect(page.getAllByText("Неизвестно")).toHaveLength(3);
    await expect(
      page.getByText("Бот ещё не проверял состояние в группе."),
    ).toBeVisible();
  },
};

export const GrantProduct: Story = {
  globals: desktop.globals,
  name: "Выдать продукт",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(page.getByRole("button", { name: "Выдать продукт" }));
    const dialog = await body().findByRole("dialog", {
      name: "Выдать продукт",
    });
    await userEvent.click(
      await within(dialog).findByRole("radio", {
        name: `${ai.name} · уже выдан`,
      }),
    );
    await expect(
      within(dialog).getByText(/Выдача ничего не изменит/u),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: practice.name }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Выдать продукт" }),
    );
    await expect(within(dialog).getByText("Выберите причину")).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Подарок" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Выдать продукт" }),
    );
    await expect(await page.findByText("Доступ выдан.")).toBeVisible();
    await expect(written).toHaveBeenCalledTimes(1);
  },
};

export const GrantProductMobile: Story = {
  globals: mobile.globals,
  name: "Выдать продукт · телефон",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      routeContent(canvasElement).getByRole("button", {
        name: "Выдать продукт",
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: "Выдать продукт",
    });
    await within(dialog).findByRole("radio", { name: practice.name });
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const GrantRevokedProduct: Story = {
  globals: desktop.globals,
  name: "Выдать отозванный · ведёт к восстановлению",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      routeContent(canvasElement).getByRole("button", {
        name: "Выдать продукт",
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: "Выдать продукт",
    });
    await userEvent.click(
      await within(dialog).findByRole("radio", {
        name: `${architecture.name} · отозван`,
      }),
    );
    await expect(
      within(dialog).getByText(/Выдача его не вернёт/u),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Перейти к восстановлению" }),
    );
    await expect(
      await body().findByRole("dialog", {
        name: `Восстановить доступ к «${architecture.name}»`,
      }),
    ).toBeVisible();
  },
};

export const GrantCatalogUnavailable: Story = {
  parameters: { access: { catalog: "unavailable" } },
  globals: desktop.globals,
  name: "Выдать продукт · каталог недоступен",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      routeContent(canvasElement).getByRole("button", {
        name: "Выдать продукт",
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: "Выдать продукт",
    });
    await expect(
      await within(dialog).findByText(/Список продуктов сейчас не загрузился/u),
    ).toBeVisible();
    await expect(
      within(dialog).getByRole("button", { name: "Выдать продукт" }),
    ).toBeDisabled();
  },
};

export const RevokeProduct: Story = {
  globals: desktop.globals,
  name: "Отозвать с причиной и последствием",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      panel(canvasElement, ai.name).getByRole("button", {
        name: `Отозвать доступ к «${ai.name}»`,
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: `Отозвать доступ к «${ai.name}»?`,
    });
    await expect(
      within(dialog).getByText(
        "Группа в Telegram закроется: у человека не останется другого продукта с группой.",
      ),
    ).toBeVisible();
    await expect(
      within(dialog).getByRole("button", { name: "Отмена" }),
    ).toHaveFocus();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Другое" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Отозвать доступ" }),
    );
    await expect(within(dialog).getByText("Опишите причину")).toBeVisible();
    await userEvent.type(
      within(dialog).getByLabelText("Заметка"),
      "Попросил партнёр",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Отозвать доступ" }),
    );
    await expect(
      await routeContent(canvasElement).findByText(
        `Доступ к «${ai.name}» отозван.`,
      ),
    ).toBeVisible();
  },
};

export const RevokeProductMobile: Story = {
  parameters: { access: { community: "remains" } },
  globals: mobile.globals,
  name: "Отозвать · телефон, группа остаётся",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      panel(canvasElement, ai.name).getByRole("button", {
        name: `Отозвать доступ к «${ai.name}»`,
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: `Отозвать доступ к «${ai.name}»?`,
    });
    await expect(
      within(dialog).getByText(
        "Группа в Telegram останется: её даёт другой продукт человека.",
      ),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const RestoreProduct: Story = {
  globals: desktop.globals,
  name: "Восстановить с подтверждением",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      panel(canvasElement, architecture.name).getByRole("button", {
        name: `Восстановить доступ к «${architecture.name}»`,
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: `Восстановить доступ к «${architecture.name}»`,
    });
    await expect(within(dialog).getByLabelText("Причина")).toHaveFocus();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Восстановить доступ" }),
    );
    await expect(within(dialog).getByText("Напишите причину")).toBeVisible();
    await userEvent.type(
      within(dialog).getByLabelText("Причина"),
      "Оплата нашлась в банке",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Восстановить доступ" }),
    );
    await expect(
      await routeContent(canvasElement).findByText(
        `Доступ к «${architecture.name}» восстановлен.`,
      ),
    ).toBeVisible();
  },
};

export const RevisionConflict: Story = {
  parameters: { access: { reply: "revision_conflict" } },
  globals: desktop.globals,
  name: "Конфликт ревизии · «Обновить данные»",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      panel(canvasElement, architecture.name).getByRole("button", {
        name: `Восстановить доступ к «${architecture.name}»`,
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: `Восстановить доступ к «${architecture.name}»`,
    });
    await userEvent.type(within(dialog).getByLabelText("Причина"), "Сверка");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Восстановить доступ" }),
    );
    const alert = await routeContent(canvasElement).findByRole("alert");
    await expect(alert).toHaveTextContent(
      "Доступ изменился, пока была открыта карточка.",
    );
    await expect(written).not.toHaveBeenCalled();
    await userEvent.click(
      within(alert).getByRole("button", { name: "Обновить данные" }),
    );
    await expect(refreshed).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(routeContent(canvasElement).queryByRole("alert")).toBeNull(),
    );
  },
};

export const RevisionConflictMobile: Story = {
  parameters: { access: { preview: 9 } },
  globals: mobile.globals,
  name: "Конфликт ревизии до отзыва · телефон",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      panel(canvasElement, ai.name).getByRole("button", {
        name: `Отозвать доступ к «${ai.name}»`,
      }),
    );
    await expect(
      await routeContent(canvasElement).findByRole("alert"),
    ).toHaveTextContent("Доступ изменился");
    await expect(body().queryByRole("dialog")).toBeNull();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const OperationConflict: Story = {
  parameters: { access: { reply: "operation_conflict" } },
  globals: desktop.globals,
  name: "Повтор операции с другими данными",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      panel(canvasElement, architecture.name).getByRole("button", {
        name: `Восстановить доступ к «${architecture.name}»`,
      }),
    );
    const dialog = await body().findByRole("dialog", {
      name: `Восстановить доступ к «${architecture.name}»`,
    });
    await userEvent.type(within(dialog).getByLabelText("Причина"), "Сверка");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Восстановить доступ" }),
    );
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Мы подготовили новый: повторите действие.",
    );
  },
};

export const NotFound: Story = {
  args: { state: { kind: "not_found" } },
  globals: desktop.globals,
  name: "Человек не найден",
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("link", { name: "К списку людей" }),
    ).toHaveAttribute("href", authoringPeopleHref);
  },
};

export const Unavailable: Story = {
  args: { state: { kind: "unavailable", reference: "dependency_unavailable" } },
  globals: desktop.globals,
  name: "Карточка недоступна",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(page.getByRole("button", { name: "Повторить" }));
    await expect(retried).toHaveBeenCalledTimes(1);
  },
};

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Нет доступа",
};

export const Loading: Story = {
  globals: desktop.globals,
  name: "Загрузка",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("main", {
        name: "Загрузка карточки человека",
      }),
    ).toHaveAttribute("aria-busy", "true");
  },
  render: () => <AuthoringPersonLoading />,
};

export const LoadingMobile: Story = {
  ...Loading,
  globals: mobile.globals,
  name: "Загрузка · телефон",
};

let deliverCard: () => void = () => undefined;

function heldCardFetch(): MutationFetch {
  const delivered = new Promise<void>((resolve) => {
    deliverCard = resolve;
  });
  const access = accessFetch();
  return async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (url.pathname === `/api/authoring/people/${storyAnnaId}`) {
      await delivered;
      return Response.json(cardState(annaCard));
    }
    return access(input, init);
  };
}

/**
 * Скелет `loading.tsx` стоит в геометрии карточки: возврат к списку, начало шапки и заголовок не
 * сдвигаются. Высота шапки дальше зависит от длины имени и контактов, поэтому она не сравнивается.
 */
function loadsInPlace({ globals, width }: StoryViewport): Story {
  return {
    beforeEach: () => {
      const restoreEnvironment = environment.beforeEach();
      getQueryClient().removeQueries({ queryKey: ["authoring"] });
      const restoreFetch = fetchBeforeRender(heldCardFetch())();
      return () => {
        restoreFetch();
        restoreEnvironment?.();
      };
    },
    globals,
    name: `Загрузка на месте · ${String(width)}`,
    play: async ({ canvasElement }) => {
      await settleStoryFrame(width);
      await expect(
        routeContent(canvasElement).getByText("Загружаем карточку человека"),
      ).toBeInTheDocument();
      const measure = () => ({
        back: boxOf(canvasElement, "[data-person-back]"),
        header: originOf(
          boxOf(canvasElement, "[data-person-card-head] header"),
        ),
      });
      const skeleton = measure();
      deliverCard();
      await expect(
        await within(canvasElement).findByRole("heading", {
          level: 1,
          name: "Анна Петрова",
        }),
      ).toBeVisible();
      await expect(measure()).toEqual(skeleton);
    },
    render: () => <AuthoringPersonPage accountId={storyAnnaId} />,
  };
}

export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
