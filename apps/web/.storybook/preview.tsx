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
    controls: {
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
        order: ["Foundation", "Navigation", "Compositions"],
      },
    },
  },
};

export default preview;
