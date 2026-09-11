import { notFound } from "next/navigation";

import { materialSocialCard } from "@/_pages/material-reader";
import { loadMaterialReader } from "@/_pages/material-reader.server";
import { socialCardResponse } from "@/shared/link-preview/index.server";

/**
 * Карточка ссылки на материал без обложки. Название берётся из публичной проекции материала,
 * а не из адреса: чужой текст в карточку Inside попасть не может.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const result = await loadMaterialReader(slug);
  if (result.kind === "not-found" || result.kind === "unavailable") {
    notFound();
  }
  return socialCardResponse(materialSocialCard(result.material));
}
