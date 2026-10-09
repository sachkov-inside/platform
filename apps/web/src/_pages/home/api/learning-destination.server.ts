import "server-only";

import {
  currentBillingSchema,
  isProductCapability,
  productCapability,
} from "@/entities/subscription";
import { requestCurrentBilling } from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

import { readPublicHome } from "./public-home.public-cache.server";

/**
 * Куда ведёт пункт «Курс» навигации: в программу закреплённого продукта, если он открыт человеку
 * по действующему основанию; если открыт другой продукт или закрепление не прочиталось — к
 * покупкам; иначе на Главную. Продукт на Главной один, поэтому и курс один
 * (решение владельца 09.10.2026). Сбой любого чтения тоже ведёт на Главную, а не в ошибку.
 */
export async function readLearningDestination(): Promise<string> {
  const accessToken = await getOptionalPlatformAccessToken();
  if (accessToken === undefined) return "/";
  try {
    const [billing, home] = await Promise.all([
      requestCurrentBilling(accessToken),
      readPublicHome(),
    ]);
    if (!billing.ok) return "/";
    const parsed = currentBillingSchema.safeParse(billing.body);
    const pinned = home.kind === "ready" ? home.value.pinnedSeries : null;
    if (!parsed.success) return "/";
    const active = parsed.data.grounds.filter((ground) => ground.active);
    if (
      pinned !== null &&
      active.some((ground) =>
        ground.capabilities.includes(productCapability(pinned.id)),
      )
    )
      return productProgrammeHref(pinned.slug);
    // Открыт другой продукт или Главная не прочиталась: пункт «Курс» виден, поэтому ведёт к
    // покупкам, где есть ссылка на продукт.
    return active.some((ground) =>
      ground.capabilities.some(isProductCapability),
    )
      ? "/account/purchases"
      : "/";
  } catch {
    return "/";
  }
}
