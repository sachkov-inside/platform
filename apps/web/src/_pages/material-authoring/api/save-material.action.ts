"use server";

import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import type { SaveMaterialActionState } from "../model/save-material-state";
import type { MaterialAuthoringActionState } from "../model/material-authoring-action-state";
import { executeSaveMaterial } from "./save-material";

export async function saveMaterialAction(
  _previousState: MaterialAuthoringActionState,
  formData: FormData,
): Promise<SaveMaterialActionState> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return { kind: "unauthorized" };
    }
    throw error;
  }
  return executeSaveMaterial(formData, accessToken);
}
