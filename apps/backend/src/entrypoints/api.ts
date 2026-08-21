import "reflect-metadata";

import { readApiListenConfig } from "../config/api-listen";
import { createApiApplication } from "./api/create-api-application";

async function bootstrap(): Promise<void> {
  const config = readApiListenConfig();
  const app = await createApiApplication();

  await app.listen(config.port, config.host);
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
