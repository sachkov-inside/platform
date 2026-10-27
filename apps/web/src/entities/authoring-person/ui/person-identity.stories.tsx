import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { PersonIdentity } from "./person-identity";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const people = [
  {
    accountId: "d1210000-0000-4000-8000-000000000001",
    displayName: "Анна Петрова",
    username: "anna_petrova",
    email: "anna.petrova@example.test",
    contactsState: "complete",
  },
  {
    accountId: "d1210000-0000-4000-8000-000000000002",
    displayName: "Константин Константинопольский-Задунайский",
    username: null,
    email: "konstantin.zadunaisky.long.address@example.test",
    contactsState: "complete",
  },
  {
    accountId: "d1210000-0000-4000-8000-000000000003",
    displayName: null,
    username: "only_username",
    email: null,
    contactsState: "complete",
  },
  {
    accountId: "d1210000-0000-4000-8000-000000000004",
    displayName: null,
    username: null,
    email: "buyer.only@example.test",
    contactsState: "complete",
  },
  {
    accountId: "d1210000-0000-4000-8000-000000000006",
    displayName: null,
    username: null,
    email: null,
    contactsState: "partial",
  },
] as const;

/** Подписи человека в порядке решения 5 и без контактов: заголовок никогда не UUID. */
function Variants() {
  return (
    <ul className="m-0 grid max-w-md list-none gap-4 p-0">
      {people.map((person) => (
        <li
          key={person.accountId}
          className="min-w-0 rounded-lg border border-border p-3"
        >
          <PersonIdentity accountId={person.accountId} identity={person} />
        </li>
      ))}
      <li className="min-w-0 rounded-lg border border-border p-3">
        <PersonIdentity
          accountId="d1210000-0000-4000-8000-000000000005"
          identity={null}
        />
      </li>
    </ul>
  );
}

const meta = {
  title: "Components/Админка/PersonIdentity",
  component: PersonIdentity,
  parameters: { layout: "padded" },
  args: { accountId: people[0].accountId, identity: people[0] },
} satisfies Meta<typeof PersonIdentity>;
export default meta;
type Story = StoryObj<typeof meta>;

export const VariantsDesktop: Story = {
  ...desktop,
  render: () => <Variants />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Анна Петрова")).toBeVisible();
    await expect(
      canvas.getByText("@anna_petrova · anna.petrova@example.test"),
    ).toBeVisible();
    await expect(canvas.getByText("@only_username")).toBeVisible();
    await expect(
      canvas.getByText("Контакты временно недоступны"),
    ).toBeVisible();
    await expect(canvas.getByText("Нет данных о человеке")).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: "Скопировать ID d1210000-0000-4000-8000-000000000005",
      }),
    ).toBeVisible();
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.clientWidth,
    );
  },
};

export const VariantsMobile: Story = { ...VariantsDesktop, ...mobile };
