import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
import { SeriesOrderRouteState } from "@/features/series-order";
import {
  getOptionalPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";
import { getContentCollections } from "../api/get-content-collections";
import { SeriesEditorPageClient } from "./series-editor-page.client";

export async function SeriesEditorPage({
  seriesId,
}: {
  readonly seriesId: string;
}) {
  let token: string | undefined;
  try {
    token = await getOptionalPlatformAccessToken();
  } catch (error) {
    if (!(error instanceof LogtoSessionUnavailableError)) throw error;
  }
  const returnHref = `/authoring/playlists/${seriesId}`;
  const unauthorized = (
    <MaterialAuthoringUnauthorizedState
      context="editor"
      action={<MaterialAuthoringSignInActions returnHref={returnHref} />}
    />
  );
  if (token === undefined) return unauthorized;
  const state = await getContentCollections("series", token);
  if (state.kind === "unauthorized") return unauthorized;
  if (state.kind === "error")
    return <SeriesOrderRouteState retryHref={returnHref} state={state} />;
  const collection = state.collections.find(({ id }) => id === seriesId);
  if (collection === undefined)
    return <SeriesOrderRouteState state={{ kind: "not_found" }} />;
  return (
    <SeriesEditorPageClient
      key={`${collection.id}:${String(collection.version)}`}
      initialCollection={collection}
    />
  );
}
