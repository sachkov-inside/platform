// @ts-check
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { Channel } from "storybook/internal/channels";
import { experimental_UniversalStore as UniversalStore } from "storybook/internal/core-server";
import * as common from "storybook/internal/common";
let runner;
mock.module("storybook/internal/common", {
  namedExports: {
    ...common,
    executeNodeCommand(args) {
      runner = common.executeNodeCommand({
        ...args,
        scriptPath: fileURLToPath(new URL("./ipc-child.mjs", import.meta.url)),
      });
      return runner;
    },
  },
});
const channel = new Channel({ async: true });
UniversalStore.__prepare(channel, UniversalStore.Environment.SERVER);
const { experimental_serverChannel } =
  await import("@storybook/addon-vitest/preset");
await experimental_serverChannel(channel, {
  configDir: fileURLToPath(new URL("../../../.storybook", import.meta.url)),
  presets: {
    async apply(name, fallback) {
      switch (name) {
        case "core":
          return { builder: "@storybook/builder-vite", disableTelemetry: true };
        case "framework":
          return "@storybook/react-vite";
        case "previewAnnotations":
          return [];
        case "storyIndexGenerator":
          return {
            getIndex: async () => ({ v: 5, entries: {} }),
            onInvalidated() {},
          };
        default:
          return fallback;
      }
    },
  },
});
let delivered = 0;
const completed = new Promise((resolve) =>
  channel.on("inside:runner-probe", () => {
    delivered++;
    if (delivered === 16) resolve();
  }),
);
const store = UniversalStore.create({ id: "storybook/test" });
store.send({ type: "TOGGLE_WATCHING", payload: { to: true } });
await completed;
const result = await runner;
console.log(JSON.stringify({ delivered, buffered: result.ipcOutput.length }));
process.exit(0);
