import "reflect-metadata";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import { createApiApplication } from "./api/create-api-application.js";

async function bootstrap(): Promise<void> {
  const app = await createApiApplication();
  const config = app.get<PlatformConfig>(PLATFORM_CONFIG);

  try {
    await app.listen(config.api.port, config.api.host);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
