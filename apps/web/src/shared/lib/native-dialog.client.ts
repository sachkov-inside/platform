"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefCallback,
  type RefObject,
  type SyntheticEvent,
} from "react";

const initialFocusTargets = new WeakMap<HTMLDialogElement, HTMLElement>();

/** Register a form's initial target, including forms mounted in an already open modal. */
export function dialogInitialFocus(element: HTMLElement | null) {
  if (element === null) return;
  const dialog = element.closest("dialog");
  if (dialog === null) return;
  initialFocusTargets.set(dialog, element);
  if (dialog.matches(":modal")) element.focus();
  return () => {
    if (initialFocusTargets.get(dialog) === element)
      initialFocusTargets.delete(dialog);
  };
}

/** Keep the same element available for validation as well as native modal autofocus. */
export function useDialogInitialFocus<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active = true,
): RefCallback<T> {
  return useCallback(
    (element: T | null) => {
      ref.current = element;
      if (element === null) return;
      const release = active ? dialogInitialFocus(element) : undefined;
      return () => {
        release?.();
        if (ref.current === element) ref.current = null;
      };
    },
    [active, ref],
  );
}

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
  // Child refs register before the modal opens: https://github.com/sachkov-inside/platform/issues/2255.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (open && !element.open) {
      element.showModal();
      initialFocusTargets.get(element)?.focus();
    }
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
