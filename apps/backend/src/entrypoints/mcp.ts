import "reflect-metadata";

import { runRuntimeProcess } from "./run-runtime-process.js";

void runRuntimeProcess("mcp").catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
