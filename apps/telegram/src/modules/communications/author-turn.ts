import type { AuthorContentValidationResult } from "./author-content-validation.js";
import {
  emptyAuthorState,
  pageAuthorMenu,
  type AuthorAction,
  type AuthorBroadcast,
  type AuthorButton,
  type AuthorSequenceState,
  type AuthorState,
  type ComposerState,
} from "./author-dialog.js";
import type { StatisticsResult } from "./communication-statistics.js";
import {
  CommunicationsError,
  type TemplateContent,
  type TemplateSnapshot,
} from "./communications-contract.js";
import type { SequencePreview } from "./sequence-preview.js";
import type {
  CommunicationSequenceSnapshot,
  IntroSnapshot,
  MessagePart,
} from "./sequence-types.js";

/** What a transition may read besides the session: facts loaded before it and fresh IDs. */
export interface DialogEnvironment {
  /** Broadcasts and sequence blocks that have a saved unfinished message. */
  readonly pendingCompositions: ReadonlySet<string>;
  readonly now: Date;
  newId(): string;
}

export type StatisticsCounts = StatisticsResult["statistics"]["deliveries"];
export type LifecycleAction = Extract<
  AuthorAction,
  { kind: "seq:life" }
>["value"];

/** What the dialog shows once a saved sequence comes back. */
export type AfterSequenceSave =
  | { readonly kind: "card" }
  /** The message from the sequence composer is saved; ask for the next one. */
  | { readonly kind: "next-message"; readonly destinationId: string };
/** What the dialog shows once a saved broadcast comes back. */
export type AfterSave =
  | AfterSequenceSave
  | { readonly kind: "confirm-launch" }
  | { readonly kind: "batch" };

export type ValidationPurpose = "intro" | "preview" | "publish";
export type SequenceListItem = {
  readonly id: string;
  readonly name: string;
  /** `edited` when an unsaved draft exists, otherwise the saved lifecycle. */
  readonly status: CommunicationSequenceSnapshot["lifecycle"] | "edited";
};

/**
 * Work the dialog asks the executing layer to do. A query is always the last effect of a
 * transition; its answer comes back as the event named beside it.
 */
export type AuthorEffect =
  /** Sends the menu; the executor edits the previous one only for a callback. */
  | {
      readonly kind: "menu";
      readonly text: string;
      readonly buttons: readonly { text: string; callbackData: string }[];
      /** A message was sent after the previous menu, so it must not be edited. */
      readonly fresh: boolean;
    }
  | { readonly kind: "message"; readonly content: TemplateContent }
  | {
      readonly kind: "test-send";
      readonly templateId: string;
      readonly revision: number;
    }
  | {
      readonly kind: "retain-broadcast";
      readonly broadcast: AuthorBroadcast;
      readonly name: string | undefined;
    }
  | {
      readonly kind: "retain-sequence-draft";
      readonly sequenceAuthor: AuthorSequenceState | undefined;
    }
  | { readonly kind: "remove-draft"; readonly id: string }
  | { readonly kind: "discard-composition"; readonly id: string }
  | AuthorQuery;

/** Effects answered by an event: reads and writes whose result the dialog shows. */
export type AuthorQuery =
  /** Answered by `statistics-read`. */
  | {
      readonly kind: "read-statistics";
      readonly broadcastId?: string | undefined;
    }
  /** Answered by `posts-listed`. */
  | {
      readonly kind: "list-posts";
      readonly purpose: "posts" | "library";
      readonly cursor?: string | undefined;
      readonly search?: string | undefined;
    }
  /** Answered by `post-read`. */
  | {
      readonly kind: "read-post";
      readonly purpose: "post" | "library";
      readonly templateId: string;
    }
  /** Answered by `post-saved`, or by `post-conflict` when the conflict is reported. */
  | {
      readonly kind: "save-post";
      readonly templateId: string;
      readonly content: TemplateContent;
      readonly revision: number;
      readonly reportConflict: boolean;
    }
  /** Answered by `broadcast-saved`. */
  | {
      readonly kind: "save-broadcast";
      readonly broadcast: AuthorBroadcast;
      readonly then: AfterSave;
    }
  /** Answered by `broadcast-changed`. */
  | {
      readonly kind: "change-broadcast";
      readonly broadcastId: string;
      readonly revision: number;
      readonly operation: "launch" | "pause" | "resume" | "cancel";
    }
  /** Answered by `broadcasts-listed`. */
  | { readonly kind: "list-broadcasts"; readonly cursor?: string | undefined }
  /** Answered by `broadcast-read`. */
  | { readonly kind: "read-broadcast"; readonly broadcastId: string }
  /** Answered by `composition-restored`. */
  | {
      readonly kind: "restore-composition";
      readonly destinationId: string;
      readonly then: "resume" | "discard";
    }
  /** Answered by `sequences-listed`. */
  | { readonly kind: "list-sequences"; readonly cursor?: string | undefined }
  /** Answered by `sequence-read`. */
  | { readonly kind: "read-sequence"; readonly sequenceId: string }
  /** Answered by `intro-read`. */
  | { readonly kind: "read-intro" }
  /** Answered by `sequence-saved`, or by `sequence-invalid` when the draft is incomplete. */
  | {
      readonly kind: "save-sequence";
      readonly sequence: CommunicationSequenceSnapshot;
      readonly then: AfterSequenceSave;
    }
  /** Answered by `content-validated`. */
  | {
      readonly kind: "validate-content";
      readonly parts: readonly MessagePart[];
      readonly purpose: ValidationPurpose;
    }
  /** Answered by `intro-saved`. */
  | { readonly kind: "save-intro"; readonly intro: IntroSnapshot }
  /** Locks the saved sequence for publication; answered by `sequence-locked`. */
  | {
      readonly kind: "lock-sequence";
      readonly sequenceId: string;
      readonly publish: boolean;
    }
  /** Answered by `sequence-published` or `publication-previewed`. */
  | {
      readonly kind: "publish-sequence";
      readonly sequenceId: string;
      readonly revision: number;
      readonly publish: boolean;
    }
  /** Answered by `sequence-changed`. */
  | {
      readonly kind: "change-sequence";
      readonly sequenceId: string;
      readonly revision: number;
      readonly action: LifecycleAction;
    }
  /** Answered by `part-history-read`. */
  | {
      readonly kind: "read-part-history";
      readonly sequenceId: string;
      readonly partId: string;
      readonly delaySeconds: number | null;
    };

/** Everything that moves the dialog: the author's input and the answers to its queries. */
export type AuthorEvent =
  | { readonly kind: "open" }
  | { readonly kind: "close" }
  | { readonly kind: "callback"; readonly data: string }
  | { readonly kind: "text"; readonly text: string; readonly content: unknown }
  /** The author's step failed on changed data and was rolled back. */
  | { readonly kind: "failed"; readonly during: "callback" | "text" }
  | {
      readonly kind: "statistics-read";
      readonly broadcastId?: string | undefined;
      readonly deliveries?: StatisticsCounts | undefined;
    }
  | {
      readonly kind: "posts-listed";
      readonly purpose: "posts" | "library";
      readonly cursor?: string | undefined;
      readonly templates: readonly TemplateSnapshot[];
      readonly nextCursor?: string | null | undefined;
    }
  | {
      readonly kind: "post-read";
      readonly purpose: "post" | "library";
      readonly template: TemplateSnapshot;
    }
  | { readonly kind: "post-saved"; readonly template: TemplateSnapshot }
  | { readonly kind: "post-conflict" }
  | {
      readonly kind: "broadcast-saved";
      readonly broadcast?: AuthorBroadcast | undefined;
      readonly then: AfterSave;
    }
  | {
      readonly kind: "broadcast-changed";
      readonly broadcast?: AuthorBroadcast | undefined;
    }
  | {
      readonly kind: "broadcasts-listed";
      readonly items: readonly {
        readonly broadcast: AuthorBroadcast;
        readonly name: string;
      }[];
      readonly nextCursor?: string | undefined;
    }
  | {
      readonly kind: "broadcast-read";
      readonly broadcast: AuthorBroadcast;
      readonly name: string;
    }
  | {
      readonly kind: "composition-restored";
      readonly composing: ComposerState;
      readonly then: "resume" | "discard";
    }
  | {
      readonly kind: "sequences-listed";
      readonly items: readonly SequenceListItem[];
      readonly nextCursor?: string | undefined;
    }
  | {
      readonly kind: "sequence-read";
      readonly sequenceAuthor: AuthorSequenceState;
    }
  | {
      readonly kind: "intro-read";
      readonly sequenceAuthor: AuthorSequenceState;
    }
  | {
      readonly kind: "sequence-saved";
      readonly sequence?: CommunicationSequenceSnapshot | undefined;
      readonly then: AfterSequenceSave;
    }
  | { readonly kind: "sequence-invalid"; readonly then: AfterSequenceSave }
  | {
      readonly kind: "content-validated";
      readonly purpose: ValidationPurpose;
      readonly result: AuthorContentValidationResult;
    }
  | { readonly kind: "intro-saved"; readonly intro?: IntroSnapshot | undefined }
  | {
      readonly kind: "sequence-locked";
      readonly publish: boolean;
      readonly revision?: number | undefined;
    }
  | {
      readonly kind: "sequence-published";
      readonly sequence: CommunicationSequenceSnapshot;
    }
  | {
      readonly kind: "publication-previewed";
      readonly preview: SequencePreview;
    }
  | {
      readonly kind: "sequence-changed";
      readonly sequence?: CommunicationSequenceSnapshot | undefined;
    }
  | {
      readonly kind: "part-history-read";
      readonly partId: string;
      readonly delaySeconds: number | null;
      readonly published: boolean;
    };

export interface Transition {
  readonly state: AuthorState;
  readonly effects: readonly AuthorEffect[];
}

export const HOME: AuthorButton[] = [
  ["Рассылки", { kind: "broadcasts" }],
  ["Последовательности", { kind: "seq:list" }],
  ["Статистика", { kind: "overview" }],
];
const BACK_HOME: AuthorButton[] = [["В меню", { kind: "home" }]];

/** One transition in progress: the working copy of the state and the effects it collected. */
export class Turn {
  readonly effects: AuthorEffect[] = [];
  private readonly pending: Set<string>;
  private waiting = false;

  constructor(
    public state: AuthorState,
    private readonly env: DialogEnvironment,
  ) {
    this.pending = new Set(env.pendingCompositions);
  }

  get now(): Date {
    return this.env.now;
  }

  newId(): string {
    return this.env.newId();
  }

  /** Starts the dialog over from an empty session. */
  reset() {
    this.state = emptyAuthorState(this.newId());
  }

  reply(text: string, buttons: AuthorButton[] = BACK_HOME) {
    this.state.menu = { text, buttons };
    this.renderMenu(0);
  }

  renderMenu(page: number) {
    const menu = this.state.menu;
    if (!menu) throw new CommunicationsError("not_found");
    const buttons = pageAuthorMenu(menu, page);
    this.state.token = this.newId();
    this.state.actions = buttons.map(([, action]) => action);
    this.emit({
      kind: "menu",
      text: menu.text,
      buttons: buttons.map(([label], index) => ({
        text: label,
        callbackData: `author:${this.state.token}:${index}`,
      })),
      fresh: this.state.freshMenu === true,
    });
    this.state.freshMenu = false;
  }

  /** Sends the message itself; the next menu comes below it instead of replacing a menu. */
  preview(content: TemplateContent) {
    this.state.freshMenu = true;
    this.emit({ kind: "message", content });
  }

  /** The buttons that continue or drop a saved unfinished message for this destination. */
  compositionButtons(id: string): AuthorButton[] {
    if (!this.pending.has(id)) return [];
    return [
      ["Продолжить сообщение", { kind: "compose:resume", id }],
      ["Отменить добавление", { kind: "compose:discard", id }],
    ];
  }

  discardComposition(id: string) {
    this.pending.delete(id);
    this.emit({ kind: "discard-composition", id });
  }

  retainBroadcast() {
    const broadcast = this.state.broadcast;
    if (broadcast)
      this.emit({
        kind: "retain-broadcast",
        broadcast,
        name: this.state.broadcastName,
      });
  }

  retainSequenceDraft() {
    this.emit({
      kind: "retain-sequence-draft",
      sequenceAuthor: this.state.sequenceAuthor,
    });
  }

  emit(effect: AuthorEffect) {
    if (this.waiting)
      throw new Error("An author query must be the last effect");
    // Later steps of the same transition keep changing the state; an effect keeps its moment.
    this.effects.push(structuredClone(effect));
  }

  /** Ends the transition with a query; its answer continues the dialog. */
  ask(query: AuthorQuery) {
    this.emit(query);
    this.waiting = true;
  }
}
