import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { Agentation } from "agentation";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import "./workshop.css";

const withWorkshop: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";
  const isTestRun = import.meta.env.MODE === "test";

  return (
    <div className={theme} data-workshop-theme={theme}>
      <div className="contents" data-workshop-story>
        <Story />
      </div>
      {!isTestRun ? (
        <div data-agentation-root>
          <Agentation className="platform-agentation" />
        </div>
      ) : null}
    </div>
  );
};

const preview: Preview = {
  decorators: [withWorkshop],
  tags: ["autodocs"],
  globalTypes: {
    theme: {
      description: "Workshop color theme",
      toolbar: {
        icon: "paintbrush",
        items: [
          { title: "Light", value: "light" },
          { title: "Dark", value: "dark" },
        ],
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      codePanel: true,
    },
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/iu,
        date: /Date$/u,
      },
    },
    a11y: {
      context: "[data-workshop-story]",
      test: "error",
    },
    options: {
      storySort: {
        order: ["Foundations", "Components", "Patterns", "Pages"],
      },
    },
    viewport: {
      options: {
        mobile320: {
          name: "Mobile 320 × 568",
          styles: {
            height: "568px",
            width: "320px",
          },
          type: "mobile",
        },
        mobile390: {
          name: "Mobile 390 × 844",
          styles: {
            height: "844px",
            width: "390px",
          },
          type: "mobile",
        },
        desktop1440: {
          name: "Desktop 1440 × 900",
          styles: {
            height: "900px",
            width: "1440px",
          },
          type: "desktop",
        },
      },
    },
  },
};

export default preview;
