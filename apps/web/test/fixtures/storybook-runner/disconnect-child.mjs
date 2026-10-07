// @ts-check
import { createServer } from "node:net";
import { mock } from "node:test";
import * as coreServer from "storybook/internal/core-server";
// Keep Vitest initialization pending; exercise the installed runner's real IPC lifecycle.
mock.module("storybook/internal/core-server", {
  namedExports: {
    ...coreServer,
    experimental_UniversalStore: {
      Environment: coreServer.experimental_UniversalStore.Environment,
      __prepare() {},
      create: () => ({
        subscribe() {},
        untilReady: () => new Promise(() => {}),
      }),
    },
  },
});
await import("@storybook/addon-vitest/vitest");
const server = createServer();
server.listen(0, "127.0.0.1", () => process.send({ type: "ready" }));
