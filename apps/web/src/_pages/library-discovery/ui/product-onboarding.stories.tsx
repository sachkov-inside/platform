import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import type { CommunityEntry } from "@/features/community-entry";
import { getQueryClient } from "@/shared/api/query-client";
import {
  buyerProgrammeFixture,
  buyerProductId,
  buyerProductName,
} from "@/storybook/buyer-journey.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";
import { MaterialReadingScope } from "@/entities/material";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { ProductProgrammeView } from "./product-programme-view";
import { ProductProgrammeOnboarding } from "./product-programme-onboarding.client";
import { SeriesLearningProvider } from "./series-learning.client";

const environment = publicPageEnvironment(
  "/products/platform-inside/programme",
  { account: "authenticated" },
);
function Programme({ started = false }: { readonly started?: boolean }) {
  return (
    <MaterialReadingScope
      value={{
        accountId: "story-account",
        resolved: true,
        states: new Map(),
        register: () => () => undefined,
        refresh: () => Promise.resolve(undefined),
        failed: false,
      }}
    >
      <SeriesLearningProvider
        learning={{
          kind: "ready",
          started,
          read: 0,
          total: 6,
          continuation: null,
        }}
      >
        <ProductProgrammeOnboarding
          accountId="story-account"
          productId={buyerProductId}
          productName={buyerProductName}
          firstLessonHref={materialReaderHref(
            "material-1",
            productProgrammeHref("platform-inside"),
          )}
        >
          <ProductProgrammeView
            result={buyerProgrammeFixture(buyerProductName)}
          />
        </ProductProgrammeOnboarding>
      </SeriesLearningProvider>
    </MaterialReadingScope>
  );
}
function entryState(entry: CommunityEntry) {
  return () => {
    environment.beforeEach();
    getQueryClient().removeQueries({ queryKey: ["account"] });
    return fetchBeforeRender(() =>
      Promise.resolve(Response.json({ ok: true, value: entry })),
    )();
  };
}
const meta = {
  ...environment,
  title: "Pages/Product/Onboarding",
  component: Programme,
  beforeEach: entryState({ kind: "link_telegram" }),
  tags: ["autodocs"],
} satisfies Meta<typeof Programme>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LinkTelegram: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Привяжите Telegram" }),
    ).toBeInTheDocument();
    await expect(
      page.getAllByRole("button", { name: "Онбординг" })[0],
    ).toHaveAttribute("aria-current", "true");
  },
};
export const LinkTelegramMobile: Story = {
  ...LinkTelegram,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const JoinCommunity: Story = {
  beforeEach: entryState({
    kind: "join",
    botUrl: "https://t.me/inside_storybook_bot",
  }),
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByRole("link", {
        name: "Вступить в сообщество",
      }),
    ).toHaveAttribute("href", "https://t.me/inside_storybook_bot");
  },
};
export const Preparing: Story = {
  beforeEach: entryState({ kind: "preparing" }),
};
export const Restricted: Story = {
  beforeEach: entryState({ kind: "restricted" }),
};
export const FirstLesson: Story = {
  beforeEach: entryState({ kind: "member" }),
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByRole("link", {
        name: "Начать первый урок",
      }),
    ).toHaveAttribute("href", expect.stringContaining("/materials/material-1"));
  },
};
export const Completed: Story = {
  args: { started: true },
  beforeEach: entryState({ kind: "member" }),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: buyerProductName }),
    ).toBeInTheDocument();
    await expect(
      page.queryByRole("button", { name: "Онбординг" }),
    ).not.toBeInTheDocument();
    await expect(
      page.queryByRole("region", { name: /Онбординг продукта/u }),
    ).not.toBeInTheDocument();
  },
};
export const CompletedMobile: Story = {
  ...Completed,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const WithoutCommunity: Story = {
  ...Completed,
  args: { started: false },
  beforeEach: entryState({ kind: "none" }),
};
