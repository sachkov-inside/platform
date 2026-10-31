import type { Meta, StoryObj } from "@storybook/react-vite";

import { CohortCallView } from "@/features/ai-engineering-course";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { aiEngineeringCourseChapters } from "@/storybook/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { cohortCall } from "../model/cohort-call";
import { AiEngineeringLandingV2Prototype } from "./ai-engineering-landing-v2.prototype";
import {
  type HeroVariant,
  landingPage,
} from "./ai-engineering-landing-v2.prototype-content";

/**
 * PROTOTYPE, prototype/ai-engineering-landing-v2. Лендинг курса с новыми разделами и тремя
 * вариантами первого экрана. План и решения: docs/evidence/ai-engineering-landing-v2/README.md.
 */
const environment = publicPageEnvironment("/products/ai-engineering");

const meta = {
  ...environment,
  component: AiEngineeringLandingV2Prototype,
  id: "prototypes-ai-engineering-landing-v2",
  title: "Prototypes/AI Engineering landing v2",
  args: {
    heroCall: (
      <CohortCallView
        call={cohortCall({
          cohort: null,
          offer: null,
          productAccess: "unknown",
          signedIn: false,
          slug: "ai-engineering",
        })}
      />
    ),
    page: landingPage("A"),
    returnTarget: homeMaterialReaderReturnTarget,
    result: {
      kind: "empty",
      discoveryKind: "product",
      chapters: aiEngineeringCourseChapters,
      relatedProduct: [],
      topics: [],
      reference: {
        name: "AI Engineering",
        slug: "ai-engineering",
        summary: "",
        productPage: null,
      },
    },
  },
} satisfies Meta<typeof AiEngineeringLandingV2Prototype>;
export default meta;
type Story = StoryObj<typeof meta>;

const variant = (key: HeroVariant): Story => ({
  args: { page: landingPage(key) },
});

/** A. Инженер, а не кодер: ценность смещается от кода к пониманию продукта. */
export const HeroA: Story = {
  ...variant("A"),
  name: "Заголовок A. Инженер, а не кодер",
};
/** B. AI Software Engineer: продукт, домен и инженерная база вместо ручного кода. */
export const HeroB: Story = {
  ...variant("B"),
  name: "Заголовок B. AI Software Engineer",
};
/** C. Процесс вокруг агента: агент проектирует, ты ставишь задачу и проверяешь. */
export const HeroC: Story = {
  ...variant("C"),
  name: "Заголовок C. Процесс вокруг агента",
};
