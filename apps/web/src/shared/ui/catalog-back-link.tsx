import { ArrowLeft } from "lucide-react";
import type { Route } from "next";

import { IntentPrefetchLink } from "./intent-prefetch-link.client";

/** Один вид возврата для материалов, программы, продукта и темы. */
export function CatalogBackLink({
  href,
  label,
}: {
  readonly href: Route;
  readonly label: string;
}) {
  return (
    <IntentPrefetchLink
      className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground no-underline hover:text-foreground focus-visible:outline-ring"
      href={href}
    >
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      <span>{label}</span>
    </IntentPrefetchLink>
  );
}
