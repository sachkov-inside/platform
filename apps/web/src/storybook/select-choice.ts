import { expect, userEvent, waitFor, within } from "storybook/test";

/**
 * Picks an item of the site's drop-down list (`@/shared/ui/select`): opens the list from its
 * trigger, presses the item in the layer over the page and waits for the list to close.
 */
export async function chooseInSelect(
  trigger: HTMLElement,
  label: string,
): Promise<void> {
  await userEvent.click(trigger);
  await userEvent.click(
    await within(trigger.ownerDocument.body).findByRole("option", {
      name: label,
    }),
  );
  await selectClosed(trigger);
}

/**
 * Waits until the list has left the page. While it is open the page under it takes no pointer
 * and is hidden from assistive technology, so the next step must wait for it to go.
 */
export async function selectClosed(trigger: HTMLElement): Promise<void> {
  const body = trigger.ownerDocument.body;
  await waitFor(async () => {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(
      within(body).queryByRole("listbox", { hidden: true }),
    ).toBeNull();
    await expect(body.style.pointerEvents).not.toBe("none");
    await expect(trigger.closest("[aria-hidden=true]")).toBeNull();
  });
}
