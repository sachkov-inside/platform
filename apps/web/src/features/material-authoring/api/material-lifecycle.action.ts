"use server";

import { revalidatePath } from "next/cache";

import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import type { MaterialLifecycleActionState } from "../model/material-lifecycle-state";
import { authoringMaterialsRootHref } from "../model/authoring-return";
import { executeMaterialLifecycleMutation } from "./material-lifecycle";

export async function mutateMaterialLifecycleAction(
  _previousState: MaterialLifecycleActionState,
  formData: FormData,
): Promise<MaterialLifecycleActionState> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return error instanceof LogtoSessionUnavailableError
      ? { kind: "unauthorized" }
      : { kind: "unexpected_error", reference: "identity-session" };
  }
  const result = await executeMaterialLifecycleMutation(formData, accessToken);
  if (result.kind === "deleted" || result.kind === "saved") {
    revalidatePath(authoringMaterialsRootHref);
  }
  return result;
}
