import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

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
