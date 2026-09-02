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

export async function ContentCollectionsPage({ kind }: { readonly kind: ContentCollectionKind }) {
  const accessToken = await sessionToken();
  const returnHref = kind === "topic" ? "/authoring/topics" : "/authoring/playlists";
  if (accessToken === undefined) return unauthorized(returnHref);
  const state = await getContentCollections(kind, accessToken);
  if (state.kind === "unauthorized") return unauthorized(returnHref);
  if (state.kind === "error") {
    return (
      <main className="grid min-h-svh place-items-center px-5" id="authoring-content" tabIndex={-1}>
        <div className="max-w-lg rounded-2xl bg-card p-7 text-center shadow-card">
          <h1 className="text-2xl font-semibold">Структура временно недоступна</h1>
          <p className="mt-3 text-sm text-muted-foreground">Обновите страницу. Код: {state.reference}</p>
        </div>
      </main>
    );
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
