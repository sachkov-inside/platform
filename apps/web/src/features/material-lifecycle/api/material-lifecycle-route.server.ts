import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeMaterialLifecycleMutation } from "./material-lifecycle";

export function handleMaterialLifecycleRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeMaterialLifecycleMutation);
}
