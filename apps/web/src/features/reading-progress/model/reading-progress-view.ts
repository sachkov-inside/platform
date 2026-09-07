export type ReadingActionView =
  | { readonly kind: "anonymous"; readonly loginHref: string }
  | { readonly kind: "loading" }
  | { readonly kind: "ready" | "conflict"; readonly isRead: boolean; readonly canMark: boolean }
  | { readonly kind: "pending" | "error"; readonly isRead: boolean; readonly canMark: boolean; readonly desiredIsRead: boolean };

export interface ReadingActionProps {
  readonly format: string;
  readonly view: ReadingActionView;
  readonly onSetReadingState: (isRead: boolean) => void;
  readonly onRefresh: () => void;
}

export type SeriesProgressView =
  | { readonly kind: "ready"; readonly read: number; readonly total: number }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" };
