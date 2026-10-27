import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
import { ProductOrderRouteState } from "@/features/product-order";
import {
  getOptionalPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "@/shared/auth/index.server";
import {
  authoringMaterialsRootHref,
  authoringProductEditorHref,
} from "@/shared/routing/authoring";
import { getContentCollections } from "../api/get-content-collections";
import { ProductEditorPageClient } from "./product-editor-page.client";

export async function ProductEditorPage({
  productId,
}: {
  readonly productId: string;
}) {
  let token: string | undefined;
  try {
    token = await getOptionalPlatformAccessToken();
  } catch (error) {
    if (!(error instanceof LogtoSessionUnavailableError)) throw error;
  }
  const returnHref = authoringProductEditorHref(productId);
  const unauthorized = (
    <MaterialAuthoringUnauthorizedState
      context="editor"
      action={
        // Вход возвращает в этот продукт, а кнопка возврата не ведёт на ту же страницу.
        <MaterialAuthoringSignInActions
          backHref={authoringMaterialsRootHref}
          returnHref={returnHref}
        />
      }
    />
  );
  if (token === undefined) return unauthorized;
  const state = await getContentCollections("product", token);
  if (state.kind === "unauthorized") return unauthorized;
  if (state.kind === "error")
    return <ProductOrderRouteState retryHref={returnHref} state={state} />;
  const collection = state.collections.find(({ id }) => id === productId);
  if (collection === undefined)
    return <ProductOrderRouteState state={{ kind: "not_found" }} />;
  return (
    <ProductEditorPageClient
      key={`${collection.id}:${String(collection.version)}`}
      initialCollection={collection}
    />
  );
}
