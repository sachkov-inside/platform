import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { commerceScenario as facts } from "../../../../scenarios/commerce.mjs";
import { AuthoringPeopleView } from "@/_pages/authoring-people/ui/authoring-people-view.client";
import { SalesPaymentsFrame } from "@/_pages/sales-payments/ui/sales-payments-frame";
import { PaymentsTableView } from "@/features/owner-payments/ui/payments-table.client";
import { getQueryClient } from "@/shared/api/query-client";
import { authoringPeopleHref } from "@/shared/routing/authoring";
import {
  commercePayment,
  commercePeople,
  commerceIdentity,
} from "./commerce.fixtures";
import { fetchBeforeRender } from "./mutation-mock";
import { peopleIdentitiesResponse } from "./people.fixtures";
import { authoringPageEnvironment } from "./story-environment";

function CommerceScenario({ view }: { readonly view: "payments" | "people" }) {
  return view === "people" ? (
    <AuthoringPeopleView
      catalog={{
        kind: "ready",
        products: [
          {
            productId: facts.product.id,
            name: facts.product.name,
            archived: false,
          },
        ],
      }}
      query={{}}
      state={commercePeople}
      onQueryChange={fn()}
      onRetry={fn()}
    />
  ) : (
    <SalesPaymentsFrame>
      <PaymentsTableView
        products={{
          kind: "ready",
          items: [{ id: facts.product.id, name: facts.product.name }],
        }}
        query={{ states: [] }}
        state={{
          kind: "ready",
          value: { items: [commercePayment], nextCursor: null },
        }}
        onQueryChange={fn()}
        onRetry={fn()}
      />
    </SalesPaymentsFrame>
  );
}

const environment = authoringPageEnvironment("/authoring/sales/payments");
const meta = {
  ...environment,
  title: "Pages/Commerce/Synthetic learner",
  component: CommerceScenario,
  args: { view: "payments" },
  beforeEach: [
    environment.beforeEach,
    () => {
      getQueryClient().removeQueries({ queryKey: ["authoring", "people"] });
      return fetchBeforeRender(
        (input) =>
          peopleIdentitiesResponse(input, { people: [commerceIdentity] }) ??
          Promise.resolve(new Response(null, { status: 404 })),
      )();
    },
  ],
} satisfies Meta<typeof CommerceScenario>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PendingPurchase: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(within(canvasElement).getByRole("table"));
    await expect(
      canvas.getByText("Учебный курс: от идеи к выпуску", { exact: true }),
    ).toBeVisible();
    await expect(
      await canvas.findByText("Участник Тестов", { exact: true }),
    ).toBeVisible();
    await expect(canvas.getByText(/14\s?900/u)).toBeVisible();
  },
};
export const LinkedLearner: Story = {
  beforeEach: authoringPageEnvironment(authoringPeopleHref).beforeEach,
  args: { view: "people" },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("link", {
        name: "Люди",
        current: "page",
      }),
    ).toBeVisible();
    await expect(
      within(within(canvasElement).getByRole("table")).getByText(
        "Участник Тестов",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      within(within(canvasElement).getByRole("table")).getByText(
        "@synthetic_learner · light-learner@inside.test",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
  },
};
