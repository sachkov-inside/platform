"use server";

import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import type { CreateMaterialDraftActionState } from "../model/create-material-draft-state";
import { executeCreateMaterialDraft } from "./create-material-draft";

export async function createMaterialDraftAction(
  _previousState: CreateMaterialDraftActionState,
  formData: FormData,
): Promise<CreateMaterialDraftActionState> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) {
      return { kind: "unauthorized" };
    }
    return { kind: "unexpected_error", reference: "identity-session" };
  }
  return executeCreateMaterialDraft(formData, accessToken);
}
