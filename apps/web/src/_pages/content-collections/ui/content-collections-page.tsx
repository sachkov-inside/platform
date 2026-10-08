import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
import {
  getOptionalPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";

import type { ContentCollectionKind } from "../model/content-collections";
import { getContentCollections } from "../api/get-content-collections";
import { ContentCollectionsPageClient } from "./content-collections-page.client";
import { ContentCollectionsUnavailable } from "./content-collections-unavailable";

export async function ContentCollectionsPage({
  kind,
}: {
  readonly kind: ContentCollectionKind;
}) {
  const accessToken = await sessionToken();
  const returnHref =
    kind === "topic" ? "/authoring/topics" : "/authoring/products";
  if (accessToken === undefined) return unauthorized(returnHref);
  const state = await getContentCollections(kind, accessToken);
  if (state.kind === "unauthorized") return unauthorized(returnHref);
  if (state.kind === "error") {
    return <ContentCollectionsUnavailable reference={state.reference} />;
  }
  return (
    <ContentCollectionsPageClient
      initialCollections={state.collections}
      key={state.collections
        .map(({ id, version }) => `${id}:${String(version)}`)
        .join("|")}
      kind={kind}
    />
  );
}

async function sessionToken(): Promise<string | undefined> {
  try {
    return await getOptionalPlatformAccessToken();
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) return undefined;
    throw error;
  }
}

function unauthorized(returnHref: string) {
  return (
    <MaterialAuthoringUnauthorizedState
      action={<MaterialAuthoringSignInActions returnHref={returnHref} />}
      context="editor"
    />
  );
}
