import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mergeConfig } from "vite";

import incumbent from "../.storybook/main";

/** Bounded throwaway preview; supports dependencies symlinked from the owning checkout. */
export default {
  ...incumbent,
  staticDirs: ["../public"],
  stories: [
    "../src/features/storage-notice/ui/analytics-consent-proof.stories.tsx",
  ],
  viteFinal: async (config, options) =>
    mergeConfig(await incumbent.viteFinal!(config, options), {
      server: {
        fs: {
          allow: [
            fileURLToPath(new URL("../../..", import.meta.url)),
            realpathSync(
              fileURLToPath(new URL("../../../node_modules", import.meta.url)),
            ),
          ],
        },
      },
    }),
} satisfies typeof incumbent;
