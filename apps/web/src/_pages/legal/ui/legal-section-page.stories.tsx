import { currentLegalEditions } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { publicPageEnvironment } from "@/workshop/story-environment";

import { LegalSectionPage } from "./legal-section-page";

const environment = publicPageEnvironment("/legal");

const meta = {
  ...environment,
  component: LegalSectionPage,
  title: "Pages/Legal/Раздел",
  args: { editions: currentLegalEditions() },
  tags: ["autodocs"],
} satisfies Meta<typeof LegalSectionPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Список раздела вместе с футером оболочки: те же ссылки, что на любой публичной странице. */
export const Desktop: Story = {};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
