import { NestFactory } from "@nestjs/core";

import {
  type RuntimeProcess,
  ReadinessService,
} from "../modules/readiness/readiness.service";
import { RuntimeModule } from "./runtime.module";

export async function runRuntimeProcess(processName: RuntimeProcess): Promise<void> {
  const app = await NestFactory.createApplicationContext(RuntimeModule);
  const readiness = app.get(ReadinessService);
  const report = await readiness.check(processName);

  console.info(JSON.stringify(report));

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await app.close();
}
