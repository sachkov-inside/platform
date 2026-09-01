"use client";

import { useState } from "react";

import type { MemberProfileAvatar } from "../model/member-profile";

export function ProfileAvatar({
  avatar,
  displayName,
  publicProfileId,
  size = "large",
}: {
  readonly avatar: MemberProfileAvatar | null;
  readonly displayName: string;
  readonly publicProfileId?: string;
  readonly size?: "large" | "small";
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const className =
    size === "large"
      ? "size-20 shrink-0 text-xl sm:size-24 sm:text-2xl"
      : "size-12 shrink-0 text-sm";
  const imageUrl =
    avatar === null || publicProfileId === undefined
      ? null
      : `/api/member-profiles/${encodeURIComponent(publicProfileId)}/avatar/${encodeURIComponent(avatar.avatarId)}/320`;

  if (shouldUseAvatarImage(imageUrl, failedImageUrl)) {
    return (
      /* eslint-disable-next-line next/no-img-element -- the protected route requires the viewer's session and cannot pass through the Next optimizer */
      <img
        alt={`Аватар: ${displayName.trim() || "участник"}`}
        className={`${className} rounded-full bg-muted object-cover`}
        decoding="async"
        height={320}
        onError={() => {
          setFailedImageUrl(imageUrl);
        }}
        src={imageUrl}
        width={320}
      />
    );
  }

  return (
    <div
      aria-label={`Аватар: ${displayName.trim() || "участник"}`}
      className={`${className} grid place-items-center rounded-full bg-accent/14 font-bold tracking-[-0.03em] text-foreground`}
      role="img"
    >
      {profileInitials(displayName)}
    </div>
  );
}

export function shouldUseAvatarImage(
  imageUrl: string | null,
  failedImageUrl: string | null,
): imageUrl is string {
  return imageUrl !== null && imageUrl !== failedImageUrl;
}

export function profileInitials(displayName: string): string {
  const words = displayName
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length === 0) return "SI";
  const selected = words.length === 1 ? words : [words[0], words.at(-1)];
  return selected
    .flatMap((word) => (word === undefined ? [] : Array.from(word).slice(0, 1)))
    .join("")
    .toLocaleUpperCase("ru-RU");
}
