import "server-only";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import type { ReaderGuideArtifactsResult } from "../model/reader-guide-artifacts";
import { readReaderGuideArtifacts } from "./read-reader-guide-artifacts.server";

/**
 * Артефакты продукта глазами гостя: названия и назначение видны каждому, а адрес закрытого
 * артефакта backend гостю не отдаёт. Доступность для вошедшего сюда не попадает (ADR 0027).
 */
export async function readPublicGuideArtifacts(
  guideId: string,
): Promise<ReaderGuideArtifactsResult> {
  "use cache";
  const result = await readReaderGuideArtifacts(guideId);
  applyCatalogCachePolicy(result.kind);
  return result;
}
