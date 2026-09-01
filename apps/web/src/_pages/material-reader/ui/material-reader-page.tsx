import { notFound } from "next/navigation";

import { getRelatedMaterials } from "@/features/library-discovery.server";
import { loadMaterialReader } from "../api/load-material-reader";
import { RelatedMaterialsSection } from "@/features/library-discovery";
import { MaterialReaderAccess, MaterialReaderUnavailable } from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

export async function MaterialReaderPage({
  accessToken,
  slug,
}: {
  readonly accessToken?: string;
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
    return (
      <>
        <MaterialReaderAccess cta={result.cta} material={result.material} />
        <RelatedMaterialsSection result={related} sourceSlug={slug} />
      </>
    );
  }
  if (result.kind === "unavailable") {
    return <MaterialReaderUnavailable slug={slug} />;
  }
  return (
    <MaterialReaderView
      body={result.body}
      material={result.material}
      related={related}
    />
  );
}
