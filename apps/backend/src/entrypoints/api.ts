import "reflect-metadata";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import { BillingPricing, SaleConfigurationError } from "../modules/billing/index.js";
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

void bootstrap().catch((error: unknown) => {
  // Отказ настройки печатается тем же наблюдением, что у воркера; прочие сбои — как прежде.
  console.error(error instanceof SaleConfigurationError
    ? JSON.stringify({ process: "api", status: "operator_attention", reason: error.message }) : error);
  process.exitCode = 1;
});
