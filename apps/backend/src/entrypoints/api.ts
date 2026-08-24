import "reflect-metadata";

import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createApiApplication } from "./api/create-api-application.js";

async function bootstrap(): Promise<void> {
  const config = loadPlatformConfig();
  const app = await createApiApplication(config);

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
