import { notFound } from "next/navigation";

import { getRelatedMaterials } from "@/features/library-discovery.server";
import { loadMaterialReader } from "../api/load-material-reader";
import { RelatedMaterialsSection } from "@/features/library-discovery";
import {
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { MaterialReaderAccess, MaterialReaderUnavailable } from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

export async function MaterialReaderPage({
  accessToken,
  returnTarget,
  slug,
}: {
  readonly accessToken?: string;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly slug: string;
}) {
  const [result, related] = await Promise.all([
    loadMaterialReader(slug, accessToken),
    getRelatedMaterials(slug, accessToken),
  ]);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "access") {
    const sourceHref = currentMaterialHref(slug, returnTarget);
    return (
      <>
        <MaterialReaderAccess
          cta={result.cta}
          material={result.material}
          returnTarget={returnTarget}
        />
        <RelatedMaterialsSection result={related} sourceHref={sourceHref} />
      </>
    );
  }
  if (result.kind === "unavailable") {
    return (
      <MaterialReaderUnavailable
        retryHref={currentMaterialHref(slug, returnTarget)}
        returnTarget={returnTarget}
      />
    );
  }
  return (
    <MaterialReaderView
      body={result.body}
      material={result.material}
      primaryVideo={result.primaryVideo}
      related={related}
      returnTarget={returnTarget}
      sourceHref={currentMaterialHref(slug, returnTarget)}
    />
  );
}

function currentMaterialHref(
  slug: string,
  returnTarget: MaterialReaderReturnTarget,
) {
  return materialReaderHref(
    slug,
    returnTarget.kind === "library" ? undefined : returnTarget.href,
  );
}
