import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { touchTarget } from "@/shared/ui/admin/admin.fixtures";
import { Button } from "@/shared/ui/button";
import { desktop, mobile } from "@/storybook/loads-in-place";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { authoringPageEnvironment } from "@/storybook/story-environment";

import type {
  BulkGrantIssueInput,
  BulkGrantIssueResult,
} from "../model/bulk-grant";
import {
  GrantProductDialog,
  type GrantPeopleSearchState,
  type GrantPerson,
  type GrantProductDialogProps,
} from "./grant-product-dialog.client";
import {
  storyAccountId,
  storyProductId,
  storyProductName,
  storyProductPath,
} from "./product-holders.fixtures";

const anna: GrantPerson = {
  accountId: storyAccountId(40),
  displayName: "Анна Королёва",
  username: "anna_koroleva",
  email: "anna.koroleva@example.test",
};
const andrey: GrantPerson = {
  accountId: storyAccountId(41),
  displayName: "Андрей Смирнов",
  username: "smirnov_dev",
  email: null,
};
const anastasia: GrantPerson = {
  accountId: storyAccountId(42),
  displayName: "Анастасия Белова-Константинопольская",
  username: null,
  email: "a.belova@example.test",
};
const antonio: GrantPerson = {
  accountId: storyAccountId(43),
  displayName: null,
  username: "antonio_m",
  email: "antonio@example.test",
};
const people: readonly GrantPerson[] = [anna, andrey, anastasia, antonio];

/** Поиск #1721 в историях: тот же ответ, что даст `usePeopleSearch`, без сервера. */
function usePeopleSearchFake(query: string): GrantPeopleSearchState {
  if (query === "") return { kind: "idle" };
  const needle = query.toLowerCase().replace(/^@/u, "");
  return {
    kind: "ready",
    nameSearch: "available",
    items: people.filter((person) =>
      [person.displayName, person.username, person.email].some(
        (value) => value?.toLowerCase().includes(needle) === true,
      ),
    ),
  };
}

function usePeopleSearchWithoutNames(query: string): GrantPeopleSearchState {
  const search = usePeopleSearchFake(query);
  return search.kind === "ready"
    ? {
        ...search,
        nameSearch: "unavailable",
        items: search.items.filter(
          (person) =>
            person.email?.toLowerCase() === query.toLowerCase().trim(),
        ),
      }
    : search;
}

/** Проверка заранее: у Андрея доступ уже есть, у Анастасии он отозван. */
const knownAccess: Readonly<Record<string, "active" | "revoked">> = {
  [andrey.accountId]: "active",
  [anastasia.accountId]: "revoked",
};

function precheckReplies() {
  return fetchBeforeRender((input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      window.location.origin,
    );
    const items = url.searchParams.getAll("accountIds").flatMap((accountId) => {
      const access = knownAccess[accountId];
      return access === undefined
        ? []
        : [
            {
              accountId,
              access,
              firstIssuedAt: "2026-09-12T08:00:00.000Z",
              learning: {
                readCount: 9,
                totalCount: 40,
                startedAt: "2026-09-12T10:00:00.000Z",
                lastActivityAt: "2026-10-20T19:40:00.000Z",
              },
            },
          ];
    });
    return Promise.resolve(
      Response.json({ kind: "ready", items, nextCursor: null }),
    );
  });
}

const issued: BulkGrantIssueResult = { ok: true, value: { outcome: "issued" } };
const sent = fn((_input: BulkGrantIssueInput) => Promise.resolve(issued));
const granted = fn();

/** Первая попытка для Антонио не проходит; повтор с той же ссылкой проходит. */
let antonioAttempts = 0;
const sentWithOneFailure = fn((input: BulkGrantIssueInput) => {
  if (input.accountId !== antonio.accountId) return Promise.resolve(issued);
  antonioAttempts += 1;
  return Promise.resolve<BulkGrantIssueResult>(
    antonioAttempts === 1 ? { ok: false, code: "unavailable" } : issued,
  );
});

const title = `Выдать «${storyProductName}»`;
const environment = authoringPageEnvironment(storyProductPath);

/** Страница держит открытие диалога; кнопка открывает его снова после закрытия. */
function DialogHost(props: GrantProductDialogProps) {
  const [open, setOpen] = useState(props.open);
  return (
    <>
      <Button
        className="min-h-11 px-4"
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        Выдать продукт
      </Button>
      <GrantProductDialog {...props} onOpenChange={setOpen} open={open} />
    </>
  );
}

const meta = {
  ...environment,
  title: "Pages/Authoring/Продукт/Выдать продукт",
  component: GrantProductDialog,
  render: (args) => <DialogHost {...args} />,
  args: {
    open: true,
    onOpenChange: fn(),
    productId: storyProductId,
    productName: storyProductName,
    usePeopleSearch: usePeopleSearchFake,
    send: sent,
    onGranted: granted,
  },
  beforeEach: [
    environment.beforeEach,
    precheckReplies(),
    () => {
      sent.mockClear();
      sentWithOneFailure.mockClear();
      granted.mockClear();
      antonioAttempts = 0;
    },
  ],
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "«Выдать продукт» нескольким людям: выбор поиском (до 50), одна причина, проверка доступа заранее и итог по каждому человеку. Поиск людей и выдача Product Access передаются странице; здесь их заменяют подделки.",
      },
    },
  },
} satisfies Meta<typeof GrantProductDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function dialogView() {
  return within(
    await within(document.body).findByRole("dialog", { name: title }),
  );
}

async function choose(
  view: Awaited<ReturnType<typeof dialogView>>,
  query: string,
  name: string,
) {
  const field = view.getByRole("searchbox", { name: "Найти человека" });
  await userEvent.clear(field);
  await userEvent.type(field, query);
  await userEvent.click(
    await view.findByRole("button", { name: `Добавить ${name}` }),
  );
}

async function selectThreeWithKnownAccess(
  view: Awaited<ReturnType<typeof dialogView>>,
) {
  await choose(view, "ан", "Анна Королёва");
  await choose(view, "smirnov", "Андрей Смирнов");
  await choose(view, "belova", "Анастасия Белова-Константинопольская");
  const chosen = view.getByRole("list", { name: "Выбранные люди" });
  await waitFor(() =>
    expect(within(chosen).getByText("Уже есть доступ")).toBeVisible(),
  );
  await expect(
    within(chosen).getByText(
      "Доступ отозван, восстановите в карточке человека",
    ),
  ).toBeVisible();
  await expect(view.getByText("Выбрано 3 из 50")).toBeVisible();
}

export const SelectionDesktop: Story = {
  globals: desktop.globals,
  name: "Выбор и проверка доступа · широкий экран",
  play: async () => {
    const view = await dialogView();
    await selectThreeWithKnownAccess(view);
    const submit = view.getByRole("button", { name: "Выдать 1 человеку" });
    await userEvent.click(submit);
    await expect(view.getByText("Выберите причину")).toBeVisible();
    await userEvent.click(view.getByRole("radio", { name: "Подарок" }));
    await userEvent.click(submit);

    const results = await view.findByRole("list", { name: "Итог выдачи" });
    await waitFor(() =>
      expect(view.getByRole("status")).toHaveTextContent(
        "Готово: выдано 1, уже был доступ у 1, доступ отозван у 1.",
      ),
    );
    await expect(within(results).getAllByRole("listitem")).toHaveLength(3);
    await expect(sent).toHaveBeenCalledOnce();
    const [input] = sent.mock.calls[0] ?? [];
    await expect(input).toMatchObject({
      accountId: anna.accountId,
      productId: storyProductId,
      reason: "Подарок",
    });
    await expect(input?.sourceRef).toMatch(
      new RegExp(`^admin-bulk:[0-9a-f-]{36}:${anna.accountId}$`, "u"),
    );
    await expect(granted).toHaveBeenCalledOnce();
  },
};

export const SelectionMobile: Story = {
  globals: mobile.globals,
  name: "Выбор и проверка доступа · телефон",
  play: async () => {
    const view = await dialogView();
    await selectThreeWithKnownAccess(view);
    for (const button of view.getAllByRole("button"))
      await expect(
        touchTarget(button).height,
        button.getAttribute("aria-label") ?? button.textContent,
      ).toBeGreaterThanOrEqual(40);
    const dialog = await within(document.body).findByRole("dialog", {
      name: title,
    });
    await expect(dialog.scrollWidth).toBe(dialog.clientWidth);
  },
};

async function grantWithOneFailure() {
  const view = await dialogView();
  await choose(view, "ан", "Анна Королёва");
  await choose(view, "@antonio", "@antonio_m");
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Выдать 2 людям" })).toBeEnabled(),
  );
  await userEvent.click(view.getByRole("radio", { name: "Другое" }));
  await userEvent.type(
    view.getByRole("textbox", { name: "Комментарий" }),
    "Участники закрытой встречи 18 октября",
  );
  await userEvent.click(view.getByRole("button", { name: "Выдать 2 людям" }));
  await waitFor(() =>
    expect(view.getByRole("status")).toHaveTextContent(
      "Готово: выдано 1, не удалось 1.",
    ),
  );
  await expect(
    view.getByText("Не удалось выдать. Повторите позже."),
  ).toBeVisible();
  await userEvent.click(
    view.getByRole("button", { name: "Повторить для 1 человека" }),
  );
  await waitFor(() =>
    expect(view.getByRole("status")).toHaveTextContent("Готово: выдано 2."),
  );
  const calls = sentWithOneFailure.mock.calls.map(([input]) => input);
  await expect(calls).toHaveLength(3);
  const antonioCalls = calls.filter(
    (input) => input.accountId === antonio.accountId,
  );
  await expect(antonioCalls[1]).toEqual(antonioCalls[0]);
  await expect(antonioCalls[0]?.reason).toBe(
    "Другое: Участники закрытой встречи 18 октября",
  );
  await expect(view.queryByRole("button", { name: /^Повторить/u })).toBeNull();
  return view;
}

export const PartialFailureDesktop: Story = {
  args: { send: sentWithOneFailure },
  globals: desktop.globals,
  name: "Частичная ошибка и повтор · широкий экран",
  play: async () => {
    await grantWithOneFailure();
  },
};

export const PartialFailureMobile: Story = {
  args: { send: sentWithOneFailure },
  globals: mobile.globals,
  name: "Частичная ошибка и повтор · телефон",
  play: async () => {
    const view = await grantWithOneFailure();
    await expect(
      touchTarget(view.getByRole("button", { name: "Готово" })).height,
    ).toBeGreaterThanOrEqual(44);
  },
};

export const NameSearchUnavailableDesktop: Story = {
  args: { usePeopleSearch: usePeopleSearchWithoutNames },
  globals: desktop.globals,
  name: "Поиск по имени недоступен · широкий экран",
  play: async () => {
    const view = await dialogView();
    await userEvent.type(
      view.getByRole("searchbox", { name: "Найти человека" }),
      "Анна",
    );
    await expect(
      await view.findByText(
        "Поиск по имени временно недоступен. Найдите человека по email или ID.",
      ),
    ).toBeVisible();
    await expect(
      view.getByText("Никого не нашли", { exact: false }),
    ).toBeVisible();
  },
};
