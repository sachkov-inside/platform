import { factAnnouncement } from "@/shared/api/fact-announcement";

/** A «знаю» or «повторить» write reaches the other open tabs of the same Account. */
export function termMarkChanges(accountId: string) {
  return factAnnouncement(`inside.glossary-marks.${accountId}.changed`);
}
