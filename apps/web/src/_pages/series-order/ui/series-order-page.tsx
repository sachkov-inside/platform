import { redirect } from "next/navigation";

import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
import { SeriesOrderRouteState } from "@/features/series-order";
import {
  getOptionalPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";

import { getMaterialAuthoringReferences } from "@/features/material-authoring-references.server";
import { getSeriesOrder } from "../api/get-series-order";
import { SeriesOrderPageClient } from "./series-order-page.client";

export async function SeriesOrderIndexPage() {
  const session = await sessionToken();
  if (session === undefined) return unauthorized();
  const references = await getMaterialAuthoringReferences(session);
  if (references.kind === "unauthorized") return unauthorized();
  if (references.kind === "unexpected_error") {
    return (
      <SeriesOrderRouteState
        state={{ kind: "error", reference: references.reference }}
      />
    );
  }
  const first = references.references.series[0];
  if (first !== undefined) redirect(`/authoring/playlists/${first.value}`);
  return <SeriesOrderRouteState state={{ kind: "empty" }} />;
}

export async function SeriesOrderPage({ seriesId }: { readonly seriesId: string }) {
  const session = await sessionToken();
  if (session === undefined) return unauthorized();
  const [state, references] = await Promise.all([
    getSeriesOrder(seriesId, session),
    getMaterialAuthoringReferences(session),
  ]);
  if (state.kind === "unauthorized" || references.kind === "unauthorized") {
    return unauthorized();
  }
  if (state.kind === "not_found") {
    return <SeriesOrderRouteState state={{ kind: "not_found" }} />;
  }
  if (state.kind === "error") {
    return (
      <SeriesOrderRouteState
        retryHref={`/authoring/playlists/${seriesId}`}
        state={{ kind: "error", reference: state.reference }}
      />
    );
  }
  if (references.kind === "unexpected_error") {
    return (
      <SeriesOrderRouteState
        retryHref={`/authoring/playlists/${seriesId}`}
        state={{ kind: "error", reference: references.reference }}
      />
    );
  }
  return (
    <SeriesOrderPageClient
      key={state.order.orderVersion}
      presentation={{
        ...state.order,
        options: references.references.series,
      }}
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

function unauthorized() {
  return (
    <MaterialAuthoringUnauthorizedState
      action={<MaterialAuthoringSignInActions returnHref="/authoring/playlists" />}
      context="editor"
    />
  );
}
