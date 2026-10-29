import "server-only";
import { connection } from "next/server";

import { readProductAccess } from "@/entities/subscription.sale.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { productPath } from "@/shared/routing/public-page-path";
import { purchaseInvitation } from "@/shared/routing/subscription-route";
import type { CourseReadingStep } from "@/features/library-discovery";

import { resolvePurchaseProduct } from "../api/resolve-purchase-product.server";
import type { MaterialReaderMetadata } from "../model/material-reader-view";
import { freeLessonCall, type FreeLessonCall } from "../model/purchase-product";
import { FreeLessonPurchaseCallView } from "./free-lesson-purchase-call";

/**
 * Личная часть бесплатного урока курса: доступ и продажа читаются от имени читателя вне общего
 * кеша и предзагрузки, тело урока остаётся общим. Гостю ничего не читается: его бесплатный урок
 * зовёт войти (#1825). Сбой чтения убирает призыв, а не урок.
 */
export async function FreeLessonPurchaseCall({
  material,
  productSlug,
  next,
}: {
  readonly material: Pick<MaterialReaderMetadata, "productMemberships">;
  readonly productSlug: string;
  readonly next: Pick<CourseReadingStep, "title" | "access"> | null;
}) {
  await connection();
  const call = await readFreeLessonCall({ material, productSlug, next });
  return call === null ? null : <FreeLessonPurchaseCallView call={call} />;
}

async function readFreeLessonCall({
  material,
  productSlug,
  next,
}: {
  readonly material: Pick<MaterialReaderMetadata, "productMemberships">;
  readonly productSlug: string;
  readonly next: Pick<CourseReadingStep, "title" | "access"> | null;
}): Promise<FreeLessonCall | null> {
  const productId = material.productMemberships.find(
    ({ product }) => product.slug === productSlug,
  )?.product.id;
  if (productId === undefined) return null;
  try {
    const token = await getOptionalPlatformAccessToken();
    if (token === undefined) return null;
    const access = await readProductAccess(productId, token);
    // Тому, кому курс открыт или о ком ответа нет, продажа не нужна: её и не спрашиваем.
    if (access !== "closed") return null;
    const purchase = await resolvePurchaseProduct(material, productSlug, token);
    if (purchase.kind === "unavailable") return null;
    return freeLessonCall({
      signedIn: true,
      access,
      invitation: purchaseInvitation({
        product: purchase.product,
        subscriptionOffered: false,
      }),
      courseHref: productPath(productSlug),
      next,
    });
  } catch {
    return null;
  }
}
