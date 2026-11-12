import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";

/** Public entry from the ordinary /start menu, right after the Trainer's, independent of access. */
export const AI_MODELS_MENU_BUTTON = {
  text: "ИИ-модели",
  callbackData: "ai-models:open",
} as const;

/**
 * Every request of the ИИ-модели widget starts with this digit. A press without it belongs to
 * the Trainer: older Trainer messages send unmarked lowercase requests, newer ones start with 2.
 */
export const AI_MODELS_WIDGET_MARK = "3";

/** How the person asked for ИИ-модели: `/models`, the menu or a `/start` link. */
export type AiModelsEntry = "command" | "menu" | "link";

/** A person's own request to open ИИ-модели in the private chat. */
export interface AiModelsOpening {
  readonly contact: VerifiedPrivateStart;
  readonly entry: AiModelsEntry;
  /** The source label of a section link; absent when the link has none or it is malformed. */
  readonly source?: string;
}

/** A press inside an ИИ-модели widget; Telegram vouches for the sender only. */
export interface AiModelsQuery {
  readonly contact: VerifiedPrivateStart;
  /** Telegram accepts one answer for this id and only for a few seconds. */
  readonly queryId: string;
  /** Written by the public widget, mark included: untrusted until the module parses it. */
  readonly data: string;
}
