import { redirect } from "next/navigation";

import {
  MaterialAuthoringShell,
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/features/material-authoring";
import {
  getOptionalPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";

import { getMaterialAuthoringReferences } from "../../material-authoring/api/get-material-authoring-references";
import { getSeriesOrder } from "../api/get-series-order";
import { reorderSeriesAction } from "../api/reorder-series.action";
import { SeriesOrderPageClient } from "./series-order-page.client";

export async function SeriesOrderIndexPage() {
  const session = await sessionToken();
  if (session === undefined) return unauthorized();
  const references = await getMaterialAuthoringReferences(session);
  if (references.kind !== "ready") return unauthorized();
  const first = references.references.series[0];
  if (first !== undefined) redirect(`/authoring/playlists/${first.value}`);
  return <SeriesOrderEmptyState />;
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
  if (state.kind === "not_found") return <SeriesOrderNotFoundState />;
  if (state.kind === "error") return <SeriesOrderErrorState reference={state.reference} />;
  if (references.kind === "unexpected_error") {
    return <SeriesOrderErrorState reference={references.reference} />;
  }
  return (
    <SeriesOrderPageClient
      action={reorderSeriesAction}
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

function SeriesOrderEmptyState() {
  return <State title="Плейлистов пока нет" text="Создайте плейлист в справочнике, чтобы управлять порядком материалов." />;
}

function SeriesOrderNotFoundState() {
  return <State title="Плейлист не найден" text="Возможно, он был удалён. Выберите другой плейлист." />;
}

function SeriesOrderErrorState({ reference }: { readonly reference: string }) {
  return <State title="Не удалось открыть плейлист" text={`Повторите попытку. Код обращения: ${reference}`} />;
}

function State({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <MaterialAuthoringShell current="playlists">
      <main className="grid h-full min-h-svh place-items-center bg-background p-6 text-center md:min-h-0" id="authoring-content">
        <div><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{text}</p></div>
      </main>
    </MaterialAuthoringShell>
  );
}
