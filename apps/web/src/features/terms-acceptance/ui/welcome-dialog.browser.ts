/** Owns the visible lifetime of the server-rendered, non-dismissible welcome modal. */
export function mountWelcomeDialog(element: HTMLDialogElement | null) {
  if (element === null) return;
  let active = true;
  const preventCancel = (event: Event) => {
    event.preventDefault();
  };
  const reopen = () => {
    // Repeated native dismissal can bypass cancel; a hidden retained page must stay inactive.
    if (active && element.isConnected && !element.open) element.showModal();
  };
  element.addEventListener("cancel", preventCancel);
  element.addEventListener("close", reopen);

  if (!element.matches(":modal")) {
    // Keep the focus a reader already placed inside the server-rendered dialog before hydration.
    const focused = document.activeElement;
    const kept =
      focused instanceof HTMLElement && element.contains(focused)
        ? focused
        : null;
    if (element.open) element.close();
    element.showModal();
    (
      kept ?? element.querySelector<HTMLElement>("[data-dialog-initial-focus]")
    )?.focus();
  }

  return () => {
    active = false;
    element.removeEventListener("cancel", preventCancel);
    element.removeEventListener("close", reopen);
    if (element.open) element.close();
  };
}
