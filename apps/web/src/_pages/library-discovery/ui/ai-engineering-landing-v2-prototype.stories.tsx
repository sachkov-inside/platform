import type { Meta, StoryObj } from "@storybook/react-vite";

import { CohortCallView } from "@/features/ai-engineering-course";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { aiEngineeringCourseChapters } from "@/storybook/ai-engineering-course.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { cohortCall } from "../model/cohort-call";
import { AiEngineeringLandingV2Prototype } from "./ai-engineering-landing-v2.prototype";
import { landingPage } from "./ai-engineering-landing-v2.prototype-content";

/**
 * PROTOTYPE, prototype/ai-engineering-landing-v2. Лендинг курса с новыми разделами. План и решения: docs/evidence/ai-engineering-landing-v2/README.md.
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
    page: landingPage(),
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

export const Landing: Story = { name: "Лендинг" };
