import type { Decorator, Preview } from "@storybook/react-vite";
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
import { themePreferenceStorageKey } from "@/features/theme-preference/model/theme-preference";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import { assertDeclaredViewport } from "./viewport-guard";
import "./story-frame.css";

const withStoryFrame: Decorator = (Story) => {
  return (
    <QueryProvider>
      <div data-story-frame>
        <div className="contents" data-story-content>
          <Story />
        </div>
      </div>
    </QueryProvider>
  );
};

const preview: Preview = {
  beforeEach: (context) => {
    assertDeclaredViewport(context);
    // Тема как в продукте: выбор в хранилище браузера и класс `.dark` на `<html>`. Кнопка темы
    // в шапке применяет сохранённый выбор, когда подключается, поэтому одного класса мало.
    const root = document.documentElement;
    const dark = context.globals["theme"] === "dark";
    if (dark) localStorage.setItem(themePreferenceStorageKey, "dark");
    else localStorage.removeItem(themePreferenceStorageKey);
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    return () => {
      localStorage.removeItem(themePreferenceStorageKey);
      root.classList.remove("dark");
      root.style.colorScheme = "";
    };
  },
  globalTypes: {
    theme: {
      description: "Тема оформления",
      toolbar: {
        title: "Тема",
        icon: "mirror",
        items: [
          { value: "light", title: "Светлая" },
          { value: "dark", title: "Тёмная" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
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
        method: "alphabetical",
        locales: "ru-RU",
        order: [
          "Foundations",
          ["Overview", "Design tokens"],
          "Components",
          "Patterns",
          "Pages",
        ],
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
        mobile360: {
          name: "Mobile 360 × 800",
          styles: {
            height: "800px",
            width: "360px",
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
        tablet820: {
          name: "Tablet 820 × 1180",
          styles: { height: "1180px", width: "820px" },
          type: "tablet",
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
