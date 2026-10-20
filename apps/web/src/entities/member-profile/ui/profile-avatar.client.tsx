"use client";

import { UserRound } from "lucide-react";
import { useState } from "react";

import type { MemberProfileAvatar } from "../model/member-profile";
import { presentText } from "@/shared/lib/text";

export function ProfileAvatar({
  avatar,
  displayName,
  size = "large",
  fallback = "initials",
}: {
  readonly avatar: MemberProfileAvatar | null;
  readonly displayName: string;
  readonly size?: "large" | "small" | "header";
  readonly fallback?: "initials" | "icon";
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const className =
    size === "large"
      ? "size-20 shrink-0 text-xl sm:size-24 sm:text-2xl"
      : size === "header"
        ? "size-11 shrink-0 text-sm"
        : "size-12 shrink-0 text-sm";
  // Аватар видит только владелец профиля, поэтому картинка идёт через его собственный адрес.
  const imageBase =
    avatar === null
      ? null
      : `/api/account/profile/avatar/${encodeURIComponent(avatar.avatarId)}`;

  const imageUrl = imageBase === null ? null : `${imageBase}/320`;
  if (shouldUseAvatarImage(imageUrl, failedImageUrl)) {
    return (
      /* eslint-disable-next-line next/no-img-element -- the protected route requires the viewer's session and cannot pass through the Next optimizer */
      <img
        alt={`Аватар: ${presentText(displayName.trim()) ?? "участник"}`}
        className={`${className} rounded-full bg-muted object-cover`}
        decoding="async"
        height={320}
        onError={() => {
          setFailedImageUrl(imageUrl);
        }}
        sizes={
          size === "large"
            ? "(min-width: 640px) 96px, 80px"
            : size === "header"
              ? "44px"
              : "48px"
        }
        src={imageUrl}
        srcSet={[160, 320, 640]
          .map(
            (pixels) =>
              `${imageBase ?? ""}/${String(pixels)} ${String(pixels)}w`,
          )
          .join(", ")}
        width={320}
      />
    );
  }

  return (
    <div
      aria-label={`Аватар: ${presentText(displayName.trim()) ?? "участник"}`}
      className={`${className} grid place-items-center rounded-full bg-white font-bold tracking-[-0.03em] text-black`}
      role="img"
    >
      {fallback === "icon" ? (
        <UserRound aria-hidden="true" className="size-6" strokeWidth={1.75} />
      ) : (
        profileInitials(displayName)
      )}
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
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "SI";
  const selected = words.length === 1 ? words : [words[0], words.at(-1)];
  return selected
    .flatMap((word) => (word === undefined ? [] : Array.from(word).slice(0, 1)))
    .join("")
    .toLocaleUpperCase("ru-RU");
}
