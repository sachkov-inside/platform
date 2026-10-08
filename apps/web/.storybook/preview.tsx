import type { Decorator, Preview } from "@storybook/react-vite";
import { Agentation } from "agentation";
import { sb } from "storybook/test";

// Transparent render counters for the authoring performance story; production functions still run.
sb.mock(
  "../src/widgets/material-authoring/ui/material-metadata-panel.client.tsx",
  { spy: true },
);
sb.mock(
  "../src/widgets/material-authoring/ui/material-authoring-chrome.client.tsx",
  { spy: true },
);
sb.mock("../src/features/content-covers/ui/content-cover-editor.client.tsx", {
  spy: true,
});
sb.mock(
  "../src/features/material-video/ui/material-video-authoring.client.tsx",
  { spy: true },
);

import { QueryProvider } from "@/_app/ui/query-provider.client";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import { assertDeclaredViewport } from "./viewport-guard";
import "./story-frame.css";

// Тема одна, как в продукте: production не включает `.dark` ни на одной странице.
const withStoryFrame: Decorator = (Story) => {
  const isTestRun = import.meta.env.MODE === "test";

  return (
    <QueryProvider>
      <div data-story-frame>
        <div className="contents" data-story-content>
          <Story />
        </div>
        {!isTestRun ? (
          <div data-agentation-root>
            <Agentation className="platform-agentation" />
          </div>
        ) : null}
      </div>
    </QueryProvider>
  );
};

const preview: Preview = {
  beforeEach: (context) => {
    assertDeclaredViewport(context);
  },
  decorators: [withStoryFrame],
  tags: ["autodocs"],
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
      context: "[data-story-content]",
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
        desktop1036: {
          name: "Narrow desktop 1036 × 916",
          styles: {
            height: "916px",
            width: "1036px",
          },
          type: "desktop",
        },
        desktop1209: {
          name: "Narrow desktop 1209 × 916",
          styles: {
            height: "916px",
            width: "1209px",
          },
          type: "desktop",
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
