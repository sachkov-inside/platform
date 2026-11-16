import { learningScenario as facts } from "../../../../../../scenarios/learning.mjs";
import { scenarioRoles } from "../../../../../../scenarios/roles.mjs";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MaterialReadingScope } from "@/entities/material";
import {
  learningArtifacts,
  learningProgramme,
  learningReadingStates,
  learningContinuation,
} from "@/storybook/learning.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { ProductProgrammeView } from "./product-programme-view";
import { ProductLearningProvider } from "./product-learning.client";

const environment = publicPageEnvironment(
  "/products/synthetic-learning/programme",
);
const meta = {
  ...environment,
  title: "Pages/Product/Synthetic learning",
  component: ProductProgrammeView,
  args: {
    result: learningProgramme("holder"),
    artifacts: learningArtifacts,
    productOpen: true,
  },
  decorators: [
    (Story) => (
      <MaterialReadingScope
        value={{
          accountId: scenarioRoles.holder.subject,
          resolved: true,
          states: learningReadingStates,
          register: () => () => undefined,
          refresh: () => Promise.resolve(),
          failed: false,
        }}
      >
        <ProductLearningProvider
          learning={{
            kind: "ready",
            read: facts.learning.completed.length,
            total: facts.chapters.reduce(
              (total, chapter) => total + chapter.lessons.length,
              0,
            ),
            continuation: learningContinuation,
          }}
        >
          <Story />
        </ProductLearningProvider>
      </MaterialReadingScope>
    ),
    ...environment.decorators,
  ],
} satisfies Meta<typeof ProductProgrammeView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Started: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Учебный курс: от идеи к выпуску" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: /Учебный пример: работа над проектом/ }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: /Учебный пример: покажи результат/ }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: /Продолжить/ }),
    ).toHaveAttribute("href", expect.stringContaining("synthetic-project"));
  },
};
