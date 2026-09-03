import { z } from "zod";

import type { PrivateMemberProfile } from "@/entities/member-profile";

import { parsePrivateProfile } from "@/entities/member-profile";

export interface ProfileAvatarCrop {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
}

export type ProfileAvatarMutationInput =
  | Readonly<{
      crop: ProfileAvatarCrop;
      file: File;
      kind: "upload";
      profile: PrivateMemberProfile;
    }>
  | Readonly<{
      kind: "remove";
      profile: PrivateMemberProfile;
    }>;

export type ProfileAvatarMutation = (
  input: ProfileAvatarMutationInput,
  onProgress: (progress: number) => void,
) => Promise<PrivateMemberProfile>;

const avatarProblemSchema = z
  .object({ code: z.string(), reason: z.string().optional() })
  .loose();

export class AvatarMutationError extends Error {
  readonly code: string | undefined;
  readonly reason: string | undefined;

  constructor(problem: unknown) {
    super("Profile avatar mutation failed");
    const parsed = avatarProblemSchema.safeParse(problem);
    this.code = parsed.success ? parsed.data.code : undefined;
    this.reason = parsed.success ? parsed.data.reason : undefined;
  }
}

export const mutateProfileAvatar: ProfileAvatarMutation = async (
  input,
  onProgress,
) => {
  if (input.kind === "remove") {
    const response = await fetch("/account/avatar", {
      body: JSON.stringify({ expectedVersion: input.profile.version }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "DELETE",
    });
    return readMutationResponse(response);
  }
  const checksumSha256 = await sha256(input.file);
  const form = new FormData();
  form.append("expectedVersion", String(input.profile.version));
  form.append("crop", JSON.stringify(input.crop));
  form.append("declaredSize", String(input.file.size));
  form.append("checksumSha256", checksumSha256);
  form.append("file", input.file, input.file.name);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", "/account/avatar");
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.upload.addEventListener("load", () => {
      onProgress(1);
    });
    request.addEventListener("error", () => {
      reject(new Error("network"));
    });
    request.addEventListener("load", () => {
      try {
        if (request.status < 200 || request.status >= 300) {
          reject(new AvatarMutationError(request.response));
          return;
        }
        resolve(parsePrivateProfile(request.response));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Avatar response is invalid"));
      }
    });
    request.send(form);
  });
};

async function readMutationResponse(response: Response): Promise<PrivateMemberProfile> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AvatarMutationError(body);
  return parsePrivateProfile(body);
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
