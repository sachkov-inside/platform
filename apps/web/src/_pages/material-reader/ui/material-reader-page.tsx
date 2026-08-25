import { notFound } from "next/navigation";

import { getMaterialReader } from "@/_pages/material-reader/api/get-material-reader";
import { MaterialReaderAccess, MaterialReaderUnavailable } from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

export async function MaterialReaderPage({ slug }: { readonly slug: string }) {
  const result = await getMaterialReader(slug);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "access") {
    return <MaterialReaderAccess material={result.material} reason={result.reason} />;
  }
  if (result.kind === "unavailable") {
    return <MaterialReaderUnavailable slug={slug} />;
  }
  return <MaterialReaderView body={result.body} material={result.material} />;
}
