"use client";

import { useCallback, useState } from "react";

import { useNativeDialog } from "@/shared/lib/native-dialog.client";

/** One shell owns the search command, unfinished text and the native modal lifetime. */
export function useAuthoringSearchDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const openSearch = useCallback(() => {
    setOpen(true);
  }, []);
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setText("");
  }, []);
  const closeSearch = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  const dialog = useNativeDialog({ open, onOpenChange });
  const nativeDialogRef = dialog.ref;

  const shortcutRef = useCallback(
    (element: HTMLDialogElement | null) => {
      nativeDialogRef.current = element;
      if (element === null) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          openSearch();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        if (nativeDialogRef.current === element) nativeDialogRef.current = null;
      };
    },
    [nativeDialogRef, openSearch],
  );

  return {
    open,
    openSearch,
    closeSearch,
    text,
    setText,
    dialog: { ...dialog, ref: shortcutRef },
  };
}
