import { notFound } from "next/navigation";

import {
  isReviewActive,
  PracticeReviewChat,
  toUIMessages,
} from "@/features/practice-review";
import { loadPracticeConversation } from "@/features/practice-review.server";
import {
  getPlatformAccessTokenRsc,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

/**
 * Assistant Conversation практики (#788). Закрытый помощник и недоступное задание для этого
 * Account не существуют — 404.
 */
export async function AccountPracticeReviewPage({
  practiceId,
}: {
  readonly practiceId: string;
}) {
  const accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  const load = await loadPracticeConversation(practiceId, accessToken);
  if (load.kind === "unavailable") notFound();
  if (load.kind === "failed")
    return (
      <p
        className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
        role="alert"
      >
        Не получилось загрузить беседу с помощником. Обновите страницу чуть
        позже.
      </p>
    );
  const { conversation } = load;
  const active = conversation.activeReview;
  return (
    <PracticeReviewChat
      contextVersion={conversation.practice?.contextVersion ?? null}
      criteria={conversation.practice?.criteria ?? []}
      initialMessages={toUIMessages(conversation)}
      practiceId={practiceId}
      resume={
        active !== null &&
        isReviewActive(active) &&
        active.state !== "awaiting_choice"
      }
      status={conversation.status}
      title={conversation.practice?.title ?? "Задание"}
    />
  );
}
