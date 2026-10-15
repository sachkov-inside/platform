import type { Preview } from "@storybook/react-vite";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";
import "../app/globals.css";
import "../src/storybook/design-lab/design-lab.css";

const preview: Preview = {
  parameters: { layout: "fullscreen", controls: { disable: true } },
};
export default preview;
