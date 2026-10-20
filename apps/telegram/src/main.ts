import "./config/load-environment.js";
import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { createTelegramApplication } from "./application/create-telegram-application.js";
import { loadApplicationConfig } from "./config/application-config.js";
import { reportFailure } from "./shared/failure-diagnostics.js";

const config = loadApplicationConfig(process.env);
const runtime = createTelegramApplication(config);
const removeSignals = (): void => {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
};
const stop = (): void => {
  void runtime.close().then(removeSignals, (error: unknown) => {
    reportFailure("application.shutdown", error);
    process.exitCode = 1;
    removeSignals();
  });
};
// Own signals before awaiting startup. Repeated signals share the same cached close.
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const application = await runtime.application;
  if (application === undefined) removeSignals();
  else
    new Logger("Bootstrap").log(
      `Inside Telegram listening on ${config.host}:${config.port}`,
    );
} catch (error: unknown) {
  reportFailure("application.startup", error);
  process.exitCode = 1;
  removeSignals();
}
