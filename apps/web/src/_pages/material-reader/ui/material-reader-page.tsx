import { notFound } from "next/navigation";

import { getMaterialReader } from "@/_pages/material-reader/api/get-material-reader";
import { MaterialReaderAccess } from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

export async function MaterialReaderPage({ slug }: { readonly slug: string }) {
  const result = await getMaterialReader(slug);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "access") {
    return <MaterialReaderAccess material={result.material} reason={result.reason} />;
  }
  return <MaterialReaderView body={result.body} material={result.material} />;
}
