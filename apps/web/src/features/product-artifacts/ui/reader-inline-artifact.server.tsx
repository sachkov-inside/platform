import "server-only";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";
import { readReaderProductArtifacts } from "../api/read-reader-product-artifacts.server";
import type { InlineArtifactReference } from "../model/inline-artifact";
import { InlineArtifactDownload } from "./inline-artifact-download";

/** Personal file availability streams independently of the public Material body. */
export async function ReaderInlineArtifact({
  reference,
  href,
  label,
}: {
  readonly reference: InlineArtifactReference;
  readonly href: string;
  readonly label: ReactNode;
}) {
  await connection();
  const token = await getOptionalPlatformAccessToken();
  const result = await readReaderProductArtifacts(reference.productId, token);
  const artifact =
    result.kind === "ready"
      ? result.artifacts.find((item) => item.sourceId === reference.sourceId)
      : undefined;
  return (
    <InlineArtifactDownload artifact={artifact} href={href} label={label} />
  );
}
