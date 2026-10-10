import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { z } from "zod";
import { termDefinitionSchema } from "@inside/material-blocks";

import authoredDefinitions from "../../../../docs/contracts/authoring-terms-v1/example/definitions.json";
import {
  MaterialTermsProof,
  type TermCardProofState,
} from "./material-terms-proof.client";

const definitions = z.array(termDefinitionSchema).parse(authoredDefinitions);
const deploy = definitions.find((term) => term.title === "Деплой");
const ci = definitions.find((term) => term.title === "CI");
if (deploy === undefined || ci === undefined)
  throw new Error("The authored #443 fixture must contain deploy and CI");
const ready: TermCardProofState = {
  kind: "ready",
  title: deploy.title,
  definition: deploy.definition,
  detail: {
    href: "/materials/synthetic-first-deploy",
    label: "Первый деплой на сервер",
  },
};

const meta = {
  title: "Proofs/Material Terms",
  component: MaterialTermsProof,
  args: { state: ready },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  parameters: {
    docs: {
      description: {
        component:
          "Source-only proof #443 в собственном worktree. Авторские определения взяты из тестового пакета. Карточка использует существующие Platform tokens и установленный Radix Popover. Реальное rendering/build, catalog/docs MCP и visual acceptance ещё обязательны перед интеграцией приложения. Эти stories не доказывают API, права, кеш или editor roundtrip.",
      },
    },
  },
} satisfies Meta<typeof MaterialTermsProof>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HoverAndFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "развёртывание" });
    await userEvent.hover(trigger);
    const card = await page.findByRole("dialog", { name: "Деплой" });
    await userEvent.hover(card);
    await expect(card).toBeVisible();
    await expect(
      within(card).getByRole("link", { name: "Первый деплой на сервер" }),
    ).toHaveAttribute("href", "/materials/synthetic-first-deploy");
    trigger.focus();
    await userEvent.keyboard("{Escape}");
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
    trigger.blur();
    trigger.focus();
    await expect(await page.findByRole("dialog")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Контроль вне карточки" }),
    );
    await expect(page.queryByRole("dialog")).not.toBeInTheDocument();
  },
};

export const MobileTap: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "развёртывание",
    });
    await userEvent.click(trigger);
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        name: "Деплой",
      }),
    ).toBeVisible();
  },
};

export const TwoMaterialsOneDefinition: Story = {
  args: { secondMaterial: true },
};

export const NarrowAuthoredDefinition: Story = {
  args: {
    phrase: ci.title,
    termId: ci.id,
    state: { kind: "ready", title: ci.title, definition: ci.definition },
  },
  globals: { viewport: { value: "mobile320", isRotated: false } },
};

export const TextZoom200: Story = {
  beforeEach: () => {
    const root = document.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    return () => {
      root.style.fontSize = previous;
    };
  },
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const Loading: Story = { args: { state: { kind: "loading" } } };
export const UnpublishedOrUnavailable: Story = {
  args: { state: { kind: "unavailable" } },
};
export const DependencyFailure: Story = {
  args: { state: { kind: "failure" } },
};
