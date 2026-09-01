import {
  getPlatformAccessTokenRsc,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getAuthoringMaterials } from "../api/get-authoring-materials";
import {
  parseAuthoringMaterialsQuery,
  type AuthoringMaterialsSearchParams,
} from "../model/authoring-materials-query";
import {
  AuthoringMaterialsLoading,
  AuthoringMaterialsView,
} from "./authoring-materials-view";

export { AuthoringMaterialsLoading };

export async function AuthoringMaterialsPage({
  searchParams,
}: {
  readonly searchParams: Promise<AuthoringMaterialsSearchParams>;
}) {
  const query = parseAuthoringMaterialsQuery(await searchParams);
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return (
        <AuthoringMaterialsView
          query={query}
          state={{ kind: "signed_out" }}
        />
      );
    }
    throw error;
  }

  return (
    <AuthoringMaterialsView
      query={query}
      state={await getAuthoringMaterials(query, accessToken)}
    />
  );
}
