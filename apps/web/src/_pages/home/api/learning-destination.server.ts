import "server-only";

import {
  currentBillingSchema,
  productCapability,
} from "@/entities/subscription";
import { requestCurrentBilling } from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

import { readPublicHome } from "./public-home.public-cache.server";

/**
 * Куда ведёт пункт «Курс» навигации: в программу закреплённого продукта, если он открыт человеку
 * по действующему основанию, иначе на Главную. Продукт на Главной один, поэтому и курс один
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
    if (!billing.ok || home.kind !== "ready") return "/";
    const parsed = currentBillingSchema.safeParse(billing.body);
    const pinned = home.value.pinnedSeries;
    if (!parsed.success || pinned === null) return "/";
    const capability = productCapability(pinned.id);
    const owned = parsed.data.grounds.some(
      (ground) => ground.active && ground.capabilities.includes(capability),
    );
    return owned ? productProgrammeHref(pinned.slug) : "/";
  } catch {
    return "/";
  }
}
