import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";

import { getQueryClient } from "@/shared/api/query-client";
import { fetchBeforeRender } from "@/storybook/mutation-mock";

import type { PersonIdentity } from "../model/person-identity";
import { PeopleSearchCombobox } from "./people-search-combobox.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const people: PersonIdentity[] = [
  {
    accountId: "d1210000-0000-4000-8000-000000000001",
    displayName: "Анна Петрова",
    username: "anna_petrova",
    email: "anna.petrova@example.test",
    contactsState: "complete",
  },
  {
    accountId: "d1210000-0000-4000-8000-000000000002",
    displayName: "Анна Константинопольская-Задунайская",
    username: null,
    email: "konstantinopolskaya.long.address@example.test",
    contactsState: "complete",
  },
];

const searchRequests = fn();

/** Ответ BFF поиска людей; `name` выбирает, доступен ли поиск по имени. */
function searchResponse(name: "available" | "unavailable") {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    if (url.pathname !== "/api/authoring/people/search")
      return Promise.resolve(new Response(null, { status: 404 }));
    searchRequests(url.searchParams.get("query"));
    return Promise.resolve(
      Response.json({
        kind: "ready",
        items: name === "available" ? people : [],
        nameSearch: name,
      }),
    );
  };
}

function Picker() {
  const [person, setPerson] = useState<PersonIdentity | null>(null);
  return (
    <div className="max-w-md">
      <PeopleSearchCombobox label="Кому" value={person} onChange={setPerson} />
    </div>
  );
}

function RetainedPicker() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
        }}
      >
        Скрыть выбор
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Вернуть выбор
      </button>
      <button
        type="button"
        onClick={() => {
          setMounted(false);
        }}
      >
        Удалить выбор
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? <Picker /> : null}
      </Activity>
    </>
  );
}

const meta = {
  title: "Components/Админка/PeopleSearchCombobox",
  component: PeopleSearchCombobox,
  parameters: { layout: "padded" },
  args: { label: "Кому", value: null, onChange: fn() },
  render: () => <Picker />,
  beforeEach: () => {
    getQueryClient().clear();
    searchRequests.mockClear();
    return fetchBeforeRender(searchResponse("available"))();
  },
} satisfies Meta<typeof PeopleSearchCombobox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChooseByKeyboardDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox", { name: "Кому" });
    await userEvent.type(input, "Анна");
    const options = await canvas.findAllByRole("option");
    await expect(options).toHaveLength(2);
    await expect(searchRequests).toHaveBeenLastCalledWith("Анна");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(
      canvas.getByText("Анна Константинопольская-Задунайская"),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Изменить" }),
    ).toBeVisible();
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.clientWidth,
    );
  },
};

export const ChooseByKeyboardMobile: Story = {
  ...ChooseByKeyboardDesktop,
  ...mobile,
};

export const NameSearchUnavailableDesktop: Story = {
  ...desktop,
  beforeEach: () => {
    getQueryClient().clear();
    return fetchBeforeRender(searchResponse("unavailable"))();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByRole("combobox", { name: "Кому" }),
      "Анна",
    );
    await waitFor(async () => {
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Поиск по имени временно недоступен. Найдите человека по email или ID.",
      );
    });
    await expect(canvas.queryAllByRole("option")).toHaveLength(0);
  },
};

export const NameSearchUnavailableMobile: Story = {
  ...NameSearchUnavailableDesktop,
  ...mobile,
};

export const RetainsInputAndReleasesPendingSearch: Story = {
  ...desktop,
  render: () => <RetainedPicker />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox", { name: "Кому" });
    const timeouts = spyOn(window, "setTimeout");
    const clears = spyOn(window, "clearTimeout");
    const pendingTimer = () => {
      const at = timeouts.mock.calls.findLastIndex((args) => args[1] === 250);
      const scheduled = timeouts.mock.results[at];
      if (scheduled?.type !== "return")
        throw new Error("Missing native input debounce");
      return scheduled.value;
    };
    try {
      await userEvent.type(input, "Анна");
      const firstTimer = pendingTimer();
      await expect(searchRequests).not.toHaveBeenCalled();
      await userEvent.click(
        canvas.getByRole("button", { name: "Скрыть выбор", exact: true }),
      );
      await expect(input).not.toBeVisible();
      await expect(input.isConnected).toBe(true);
      await expect(clears).toHaveBeenCalledWith(firstTimer);
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуть выбор", exact: true }),
      );
      await expect(canvas.getByRole("combobox", { name: "Кому" })).toBe(input);
      await expect(input).toHaveValue("Анна");
      await expect(input).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(input);
      await expect(await canvas.findAllByRole("option")).toHaveLength(2);
      await expect(searchRequests).toHaveBeenLastCalledWith("Анна");
      await userEvent.type(input, "я");
      const lastTimer = pendingTimer();
      await userEvent.click(
        canvas.getByRole("button", { name: "Удалить выбор", exact: true }),
      );
      await expect(input.isConnected).toBe(false);
      await expect(clears).toHaveBeenCalledWith(lastTimer);
    } finally {
      timeouts.mockRestore();
      clears.mockRestore();
    }
  },
};
