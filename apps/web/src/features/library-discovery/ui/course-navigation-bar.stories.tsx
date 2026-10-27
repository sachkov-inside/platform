import { BookOpen, List } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { publicPageEnvironment } from "@/storybook/story-environment";
import {
  productHref,
  productProgrammeHref,
} from "@/shared/routing/subscription-route";
import {
  CourseNavigationBar,
  CourseNavigationItem,
} from "./course-navigation-bar";

const meta = {
  ...publicPageEnvironment("/products/ai-engineering"),
  title: "Features/Library/Course Navigation",
  component: CourseNavigationBar,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  args: {
    label: "Навигация курса",
    children: (
      <>
        <CourseNavigationItem
          icon={BookOpen}
          label="О курсе"
          href={productHref("ai-engineering")}
          current
        />
        <CourseNavigationItem
          icon={List}
          label="Программа"
          href={productProgrammeHref("ai-engineering")}
        />
      </>
    ),
  },
} satisfies Meta<typeof CourseNavigationBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
