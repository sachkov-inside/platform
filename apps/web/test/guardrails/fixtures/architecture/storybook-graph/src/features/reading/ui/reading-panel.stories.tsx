import { fn } from "storybook/test";

import { readingPanel } from "./reading-panel";

export default { title: "Reading", args: { ...readingPanel, onClose: fn() } };
