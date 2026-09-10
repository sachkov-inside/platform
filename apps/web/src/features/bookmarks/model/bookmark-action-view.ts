"use client";

export type BookmarkActionView =
  | { readonly kind: "loading" }
  | { readonly kind: "anonymous"; readonly loginHref: string }
  | { readonly kind: "ready"; readonly bookmarked: boolean }
  | { readonly kind: "pending"; readonly bookmarked: boolean; readonly desired: boolean }
  | { readonly kind: "error"; readonly bookmarked: boolean; readonly desired: boolean }
  | { readonly kind: "denied"; readonly bookmarked: boolean };

export interface BookmarkActionProps {
  readonly view: BookmarkActionView;
  readonly onToggle: (desired: boolean) => void;
}
