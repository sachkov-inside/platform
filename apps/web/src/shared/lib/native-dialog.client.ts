"use client";

import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

/** Owns the native modal layer, dismissal during a command and delayed close events. */
export function useNativeDialog({
  open,
  pending = false,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly pending?: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The modal layer must exist before a child form assigns its initial focus.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return {
    ref,
    onCancel(event: SyntheticEvent<HTMLDialogElement>) {
      event.preventDefault();
      if (!pending) onOpenChange(false);
    },
    onClose(event: SyntheticEvent<HTMLDialogElement>) {
      // A queued close event can arrive after a subsequent showModal.
      if (open && !event.currentTarget.open) onOpenChange(false);
    },
    onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (!pending) onOpenChange(false);
    },
  };
}
