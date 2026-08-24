import "reflect-metadata";

import { loadPlatformConfig } from "../config/load-platform-config.js";
import { runRuntimeProcess } from "./run-runtime-process.js";

void runRuntimeProcess("mcp", loadPlatformConfig()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
