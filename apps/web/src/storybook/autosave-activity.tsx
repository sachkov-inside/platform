import { Activity, useState, type ReactNode } from "react";
import { expect, spyOn, userEvent, within } from "storybook/test";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";

/** The real page stays mounted while React cleans up its effects. */
export function AutosaveActivity({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setVisible((current) => !current);
        }}
      >
        {visible ? "Скрыть Activity" : "Вернуть Activity"}
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <div data-testid="autosave-activity">{children}</div>
      </Activity>
    </>
  );
}

export async function autosaveWhileHidden(
  canvasElement: HTMLElement,
  edit: () => Promise<void>,
  outcomeText: string | RegExp,
  response?: () => Response,
  editDuringSave?: () => Promise<void>,
  expectedRequests = editDuringSave ? 2 : 1,
) {
  const canvas = within(canvasElement);
  const originalFetch = window.fetch;
  const started = Promise.withResolvers<undefined>();
  const reply = Promise.withResolvers<undefined>();
  const request = spyOn(window, "fetch").mockImplementation(
    async (input, init) => {
      started.resolve(undefined);
      await reply.promise;
      return response ? response() : originalFetch(input, init);
    },
  );
  try {
    await edit();
    await started.promise;
    if (editDuringSave) await editDuringSave();
    const completed = flushPendingEdits();
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть Activity" }),
    );
    await expect(canvas.getByTestId("autosave-activity")).not.toBeVisible();
    reply.resolve(undefined);
    await completed;
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть Activity" }),
    );
    for (const outcome of await canvas.findAllByText(outcomeText)) {
      await expect(outcome).toBeVisible();
    }
    await expect(request).toHaveBeenCalledTimes(expectedRequests);
  } finally {
    reply.resolve(undefined);
    request.mockRestore();
  }
}
