import { saveMemberProfileAction } from "@/_pages/account/api/member-profile.actions";

import { resolveAccountProfileRuntime } from "../api/resolve-account-profile-runtime";
import { ProfileOnboardingDialog } from "./profile-onboarding-dialog.client";

export async function ProfileOnboardingSlot() {
  const runtime = await resolveAccountProfileRuntime();
  return runtime.kind === "authenticated" && runtime.profile === null ? (
    <ProfileOnboardingDialog createAction={saveMemberProfileAction} />
  ) : null;
}
