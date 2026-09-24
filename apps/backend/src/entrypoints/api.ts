import "reflect-metadata";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import { reportProcessFailure } from "../infrastructure/observability/index.js";
import { BillingPricing } from "../modules/billing/index.js";
import { createApiApplication } from "./api/create-api-application.js";

async function bootstrap(): Promise<void> {
  const app = await createApiApplication();
  const config = app.get<PlatformConfig>(PLATFORM_CONFIG);

  try {
    // Включённая продажа без настроек оплаты — отказ при запуске, а не отказ каждому покупателю.
    await app.get(BillingPricing).assertSaleConfigured(config);
    await app.listen(config.api.port, config.api.host);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => reportProcessFailure("api", error));
