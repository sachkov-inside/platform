import "server-only";

import { fillGuidePageHero } from "@/entities/guide-page";
import { fillOneTimeTerms } from "@/features/billing-checkout.terms";
import { readPublicGuideOfferTerms } from "@/features/billing-checkout.terms.server";

import type { HomeResult } from "../model/home-view";
import { readPublicHome } from "./public-home.public-cache.server";

/**
 * Главная с подставленными сроками: тексты карточки закреплённого продукта берут `{access_term}`
 * и `{support_term}` из его предложения для всех. Оба чтения гостевые и приходят из общего кеша,
 * поэтому Главная по-прежнему ничего не ждёт (ADR 0027). Сбой чтения сроков срок не выдумывает.
 */
export async function readPublicHomeWithOfferTerms(): Promise<HomeResult> {
  return fillPinnedOfferTerms(await readPublicHome());
}

/**
 * Подставляет сроки в тексты закреплённого продукта уже прочитанной Главной. Карточка рисует их
 * как есть, поэтому каждый путь, который отдаёт ей Главную, проходит через эту функцию.
 */
export async function fillPinnedOfferTerms(
  result: HomeResult,
): Promise<HomeResult> {
  if (result.kind !== "ready") return result;
  const pinned = result.value.pinnedSeries;
  if (pinned === null || (pinned.card === null && pinned.hero === null))
    return result;
  const read = await readPublicGuideOfferTerms(pinned.id);
  const terms = read.kind === "ready" ? read.terms : null;
  const fill = (text: string) => fillOneTimeTerms(text, terms);
  return {
    ...result,
    value: {
      ...result.value,
      pinnedSeries: {
        ...pinned,
        card:
          pinned.card === null
            ? null
            : {
                ...pinned.card,
                action: fill(pinned.card.action),
                eyebrow: fill(pinned.card.eyebrow),
                subtitle: fill(pinned.card.subtitle),
              },
        hero:
          pinned.hero === null ? null : fillGuidePageHero(pinned.hero, fill),
      },
    },
  };
}
