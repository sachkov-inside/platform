import type { ReactNode } from "react";

import { ownSectionHref } from "@/shared/routing/reader-course-anchor";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { proseLinkClassName } from "@/shared/ui/prose-link";

import {
  readerBodyLinkHref,
  type ProductReaderContext,
} from "../model/product-reader-context";

/**
 * A link of the lesson text: a section of this lesson stays a jump within the page, a step of the
 * course opens in the course. Any other address keeps the document's own link (undefined).
 */
export function readerBodyLink(
  href: string,
  label: ReactNode,
  materialSlug: string,
  productContext: ProductReaderContext | null,
): ReactNode | undefined {
  const section = ownSectionHref(href, materialSlug);
  if (section !== undefined)
    return (
      <a className={proseLinkClassName} href={section}>
        {label}
      </a>
    );
  const target = readerBodyLinkHref(productContext, href);
  return target === undefined ? undefined : (
    <IntentPrefetchLink className={proseLinkClassName} href={target}>
      {label}
    </IntentPrefetchLink>
  );
}
