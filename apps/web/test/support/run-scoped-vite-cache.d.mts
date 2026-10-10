import type { Plugin } from "vite";

export declare function runScopedViteCache(): Plugin & {
  config(): { cacheDir: string };
};
