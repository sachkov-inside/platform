import { AuthoringMaterialsLoading } from "./authoring-materials-view";
import { AuthoringMaterialsPageQuery } from "./authoring-materials-page-query.client";
import {
  parseAuthoringMaterialsQuery,
  type AuthoringMaterialsSearchParams,
} from "../model/authoring-materials-query";

export { AuthoringMaterialsLoading };

export async function AuthoringMaterialsPage({
  searchParams,
}: {
  readonly searchParams: Promise<AuthoringMaterialsSearchParams>;
}) {
  const initialQuery = parseAuthoringMaterialsQuery(await searchParams);
  return (
    <AuthoringMaterialsPageQuery
      initialQuery={initialQuery}
      key={JSON.stringify(initialQuery)}
    />
  );
}
