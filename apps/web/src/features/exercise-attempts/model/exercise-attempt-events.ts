import { factAnnouncement } from "@/shared/api/fact-announcement";

/** A recorded Exercise Attempt reaches the other open tabs of the same Account. */
export function exerciseAttemptChanges(accountId: string) {
  return factAnnouncement(`inside.exercise-attempts.${accountId}.changed`);
}
