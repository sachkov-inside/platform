import { Activity, useState } from "react";
import { Folder } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AccountDisclosure } from "./account-disclosure.client";

function RetainedSection() {
  const [visible, setVisible] = useState(true);
  const [id, setId] = useState("purchases");
  return (
    <>
      <button
        onClick={() => {
          setVisible(!visible);
        }}
      >
        {visible ? "Скрыть" : "Вернуть"}
      </button>
      <button
        onClick={() => {
          setId("documents");
        }}
      >
        Сменить раздел
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <AccountDisclosure
          id={id}
          icon={Folder}
          title="Раздел"
          description="Сведения"
        >
          Содержимое
        </AccountDisclosure>
      </Activity>
    </>
  );
}

async function changeHash(hash: string) {
  const changed = new Promise<void>((resolve) => {
    window.addEventListener(
      "hashchange",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  location.hash = hash;
  await changed;
}

const meta = {
  component: RetainedSection,
  title: "Patterns/Account/Disclosure lifetime",
  beforeEach: () => {
    const url = location.href;
    history.replaceState(history.state, "", "#purchases");
    return () => {
      history.replaceState(history.state, "", url);
    };
  },
} satisfies Meta<typeof RetainedSection>;
export default meta;

export const SectionFollowsItsCurrentFragment: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = () =>
      canvas.getByRole("button", { name: /Раздел Сведения/u });
    await waitFor(() =>
      expect(section()).toHaveAttribute("aria-expanded", "true"),
    );
    await userEvent.click(section());
    await expect(section()).toHaveAttribute("aria-expanded", "false");
    await changeHash("other");
    await userEvent.click(canvas.getByRole("button", { name: "Скрыть" }));
    await changeHash("purchases");
    await changeHash("other");
    await userEvent.click(canvas.getByRole("button", { name: "Вернуть" }));
    await expect(section()).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(
      canvas.getByRole("button", { name: "Сменить раздел" }),
    );
    await changeHash("purchases");
    await expect(section()).toHaveAttribute("aria-expanded", "false");
    await changeHash("documents");
    await waitFor(() =>
      expect(section()).toHaveAttribute("aria-expanded", "true"),
    );
  },
};
