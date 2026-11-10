import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";

/** How the person asked for the Trainer: `/train`, the menu text or a `/start` link. */
export type TrainerEntry = "command" | "menu" | "link";

/** A person's own request to open the Trainer in the private chat. */
export interface TrainerOpening {
  readonly contact: VerifiedPrivateStart;
  readonly entry: TrainerEntry;
  /** The source label of a Trainer link; absent when the link has none or it is malformed. */
  readonly source?: string;
}

/** A press inside a Trainer widget; Telegram vouches for the sender only. */
export interface TrainerQuery {
  readonly contact: VerifiedPrivateStart;
  /** Telegram accepts one answer for this id and only for a few seconds. */
  readonly queryId: string;
  /** Written by the public widget: untrusted until the Trainer parses and checks it. */
  readonly data: string;
}
