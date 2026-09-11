import { SITE_TAGLINE } from "@/shared/link-preview";
import { socialCardResponse } from "@/shared/link-preview/index.server";

/** Карточка ссылки на главную: у площадки нет обложки, название говорит само за себя. */
export function GET(): Response {
  return socialCardResponse({ title: SITE_TAGLINE });
}
