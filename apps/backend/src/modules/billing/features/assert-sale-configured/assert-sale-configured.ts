import type { PlatformConfig } from "../../../../config/platform-config.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";

/** Настройки процесса, от которых зависит включённая в каталоге продажа. */
export interface SalePaymentConfiguration {
  readonly tbank?: PlatformConfig["tbank"];
  readonly billingContact?: PlatformConfig["billingContact"];
}

/** Отказ настройки, а не сбой зависимости: его текст не содержит значений и печатается оператору. */
export class SaleConfigurationError extends Error {
  override readonly name = "SaleConfigurationError";
}

/**
 * Продажа включена, когда у неархивного предложения в продаже есть живой вариант оплаты. Процесс,
 * который продаёт или сверяет оплату, проверяет это при запуске и не стартует молча без настроек:
 * иначе витрина показывала бы цену, а покупка отказывала бы каждому.
 */
export async function assertSaleConfigured(
  prisma: BillingPrismaClient,
  configuration: SalePaymentConfiguration,
): Promise<void> {
  const active = await prisma.billingProductPrice.count({
    where: { archived: false, published: true },
  });
  if (active === 0) return;
  if (configuration.tbank === undefined)
    throw new SaleConfigurationError(
      "Sale is enabled in the billing catalog, but TBANK_CONFIG_JSON is not configured",
    );
  if (configuration.billingContact === undefined)
    throw new SaleConfigurationError(
      "Sale is enabled in the billing catalog, but BILLING_CONTACT_* is not configured",
    );
}
