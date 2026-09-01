"use server";

import { revalidatePath } from "next/cache";

import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import type { ProfileMutationState } from "../model/member-profile";
import { executeSaveMemberProfile } from "./mutate-member-profile";

export async function saveMemberProfileAction(
  _previousState: ProfileMutationState,
  formData: FormData,
): Promise<ProfileMutationState> {
  const accessToken = await accessTokenOrNull();
  if (accessToken === null) return { kind: "unauthorized" };
  const result = await executeSaveMemberProfile(formData, accessToken);
  if (result.kind === "saved") revalidateProfileSurfaces();
  return result;
}

async function accessTokenOrNull(): Promise<string | null> {
  try {
    return await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError) return null;
    throw error;
  }
}

function revalidateProfileSurfaces(): void {
  revalidatePath("/", "layout");
  revalidatePath("/account");
}
