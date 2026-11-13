"use client";
import type { RenderedBlock } from "@inside/material-blocks";
import type { ReactNode } from "react";

import { ProfileAvatar } from "@/entities/account-profile";
import {
  LessonSteps,
  lessonParts,
  useMaterialReading,
} from "@/entities/material";
import { useAccountPresentation } from "@/features/account-access";
import { useLessonOpenedParts } from "@/features/reading-progress";
import { presentText } from "@/shared/lib/text";

/**
 * Step-by-step reveal in the Reader (#2122): the reader's own name and avatar on each reply,
 * «Вы» for a guest or a reader without a name, and opened parts from the reading progress. A
 * lesson without step breaks or «after answer» exercises reads whole and asks for nothing.
 */
export function ReaderLessonSteps(props: {
  readonly materialId: string;
  readonly blocks: readonly RenderedBlock[];
  readonly children: ReactNode;
}) {
  return lessonParts(props.blocks).count === 1 ? (
    props.children
  ) : (
    <SteppedLesson {...props} />
  );
}

function SteppedLesson({
  materialId,
  blocks,
  children,
}: {
  readonly materialId: string;
  readonly blocks: readonly RenderedBlock[];
  readonly children: ReactNode;
}) {
  const progress = useLessonOpenedParts(materialId);
  const { accountId, resolved } = useMaterialReading();
  const presentation = useAccountPresentation({
    enabled: resolved && accountId !== null,
  });
  const profile =
    accountId !== null &&
    presentation.data?.kind === "ready" &&
    presentation.data.presentation.profile.kind === "profile"
      ? presentation.data.presentation.profile.profile
      : null;
  const name = presentText(profile?.displayName.trim()) ?? "Вы";
  return (
    <LessonSteps
      blocks={blocks}
      progress={progress}
      reader={{
        name,
        avatar: (
          <ProfileAvatar
            avatar={profile?.avatar ?? null}
            displayName={profile === null ? "" : name}
            fallback="icon"
            size="reply"
          />
        ),
      }}
    >
      {children}
    </LessonSteps>
  );
}
