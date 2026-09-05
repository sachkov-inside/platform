import { notFound } from "next/navigation";

import { loadMaterialReader } from "../api/load-material-reader";
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
  const result = await loadMaterialReader(slug, accessToken);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "access") {
    return (
      <div className="@container/material-reader">
        <MaterialReaderAccess
          cta={result.cta}
          material={result.material}
          returnTarget={returnTarget}
        />
      </div>
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
      returnTarget={returnTarget}
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
