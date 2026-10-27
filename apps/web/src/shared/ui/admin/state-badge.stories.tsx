import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { StateBadge, adminStates, type AdminStateKey } from "./state-badge";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const stateKeys = Object.keys(adminStates).filter(
  (key): key is AdminStateKey => key in adminStates,
);

/** Весь словарь сразу: у состояния одно слово и один тон на всех экранах. */
function Dictionary() {
  return (
    <dl className="grid max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 text-sm">
      {stateKeys.map((key) => (
        <div className="contents" key={key}>
          <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
          <dd className="m-0">
            <StateBadge state={key} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

const meta = {
  title: "Components/Админка/StateBadge",
  component: StateBadge,
  parameters: { layout: "padded" },
  args: { state: "material.published" },
} satisfies Meta<typeof StateBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DictionaryDesktop: Story = {
  ...desktop,
  render: () => <Dictionary />,
  play: async ({ canvasElement }) => {
    // Одно слово может значить одно и то же у разных объектов («Доступ открыт» у платежа и у
    // человека), поэтому плашка ищется по ключу, а слово проверяется на ней.
    for (const key of stateKeys) {
      const badge = canvasElement.querySelector(
        `.admin-badge[data-state="${key}"]`,
      );
      await expect(badge).toHaveTextContent(adminStates[key].label);
      await expect(badge).toHaveAttribute("data-tone", adminStates[key].tone);
      await expect(badge).not.toHaveAttribute("role");
    }
  },
};

export const DictionaryMobile: Story = { ...DictionaryDesktop, ...mobile };

export const SingleDesktop: Story = { ...desktop };
export const SingleMobile: Story = {
  ...mobile,
  args: { state: "submission.awaiting" },
};
