import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { CatalogBackLink } from "@/shared/ui/catalog-back-link";

/** Logical ancestry stays separate from an optional contextual return to another collection. */
export function DiscoveryBreadcrumbs({
  name,
  returnTarget,
}: {
  readonly name: string;
  readonly returnTarget: MaterialReaderReturnTarget;
}) {
  return (
    <>
      <Breadcrumbs items={[{ label: "Главная", href: "/" }, { label: name }]} />
      {returnTarget.kind === "home" ? null : (
        <CatalogBackLink href={returnTarget.href} label={returnTarget.label} />
      )}
    </>
  );
}
