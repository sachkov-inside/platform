import { notFound } from "next/navigation";

import { getMaterialReader } from "@/_pages/material-reader/api/get-material-reader";
import { MaterialReaderAccess, MaterialReaderUnavailable } from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

export async function MaterialReaderPage({
  accessToken,
  slug,
}: {
  readonly accessToken?: string;
  readonly slug: string;
}) {
  const result = await getMaterialReader(slug, accessToken);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "access") {
    return <MaterialReaderAccess cta={result.cta} material={result.material} />;
  }
  if (result.kind === "unavailable") {
    return <MaterialReaderUnavailable slug={slug} />;
  }
  return <MaterialReaderView body={result.body} material={result.material} />;
}
