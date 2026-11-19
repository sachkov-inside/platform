import {
  CancelledError,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, waitFor, within } from "storybook/test";
import { MaterialReadingScope, useMaterialReading } from "@/entities/material";
import { ReadingProgressProvider } from "./reading-provider.client";
import { SavedReadingAction } from "./saved-reading-action.client";

import { createReadingStateBatcher } from "../model/reading-state-batcher";

const materialId = "72000000-0000-4000-8000-000000000020";

function ReadingIdentity() {
  const { accountId, resolved } = useMaterialReading();
  return <output>{resolved ? (accountId ?? "guest") : "pending"}</output>;
}

export default { title: "Patterns/Reader/Private cache" };
export const AccountAndSignout = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = document.createElement("div");
    canvasElement.append(host);
    const root = createRoot(host);
    const first = new QueryClient(),
      second = new QueryClient();
    function show(
      client: QueryClient,
      account: string | null,
      resolved: boolean,
    ) {
      flushSync(() => {
        root.render(
          <QueryClientProvider client={client}>
            <ReadingProgressProvider accountId={account} resolved={resolved}>
              <ReadingIdentity />
            </ReadingProgressProvider>
          </QueryClientProvider>,
        );
      });
    }
    const form = document.createElement("form");
    canvasElement.append(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    function submit(path: string) {
      form.action = path;
      flushSync(() => {
        form.requestSubmit();
      });
    }
    const key = ["reading-progress", "a", "material", materialId];
    const gate = Promise.withResolvers<undefined>();
    const finished = Promise.withResolvers<undefined>();
    const load = createReadingStateBatcher(async (materialIds) => {
      started.resolve(undefined);
      await gate.promise;
      return {
        kind: "ready",
        states: materialIds.map((materialId) => ({
          materialId,
          isRead: true,
          version: 1,
          readAt: null,
          updatedAt: null,
          openedParts: null,
          updateNote: null,
        })),
      };
    });
    const started = Promise.withResolvers<undefined>();
    try {
      for (const client of [first, second])
        client.setQueryData(["library"], "public");
      first.setQueryData(["bookmarks", "b"], "b");
      const result = first
        .query({
          queryKey: key,
          queryFn: () => {
            return load(materialId).finally(() => {
              finished.resolve(undefined);
            });
          },
        })
        .then(
          () => "completed",
          (error: unknown) =>
            error instanceof CancelledError ? "cancelled" : "failed",
        );
      await started.promise;
      show(first, null, false);
      await expect(first.getQueryState(key)?.fetchStatus).toBe("fetching");
      show(first, "b", true);
      gate.resolve(undefined);
      await expect(await result).toBe("cancelled");
      await finished.promise;
      await expect(first.getQueryData(key)).toBeUndefined();
      await expect(host.textContent).toBe("b");
      await expect(first.getQueryData(["bookmarks", "b"])).toBe("b");
      show(second, "b", true);
      second.setQueryData(["bookmarks", "b"], "b");
      submit("/account");
      await expect(second.getQueryData(["bookmarks", "b"])).toBe("b");
      submit("/auth/sign-out");
      await expect(first.getQueryData(["bookmarks", "b"])).toBe("b");
      await expect(second.getQueryData(["bookmarks", "b"])).toBeUndefined();
      await expect(second.getQueryData(["library"])).toBe("public");
      await expect(host.textContent).toBe("guest");
      flushSync(() => {
        root.render(null);
      });
      second.setQueryData(["bookmarks", "b"], "after");
      submit("/auth/sign-out");
      await expect(second.getQueryData(["bookmarks", "b"])).toBe("after");
    } finally {
      gate.resolve(undefined);
      root.unmount();
      form.remove();
      host.remove();
      first.clear();
      second.clear();
    }
  },
};
export const AccessReturns = {
  render: () => <div />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = document.createElement("div");
    canvasElement.append(host);
    const root = createRoot(host);
    const client = new QueryClient();
    const key = ["reading-progress", "a", "set-state", materialId];
    const cache = client.getMutationCache();
    const state = {
      context: undefined,
      data: undefined,
      error: null,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
      variables: undefined,
      submittedAt: 1,
    };
    const denied = { kind: "denied" };
    // The query client is the public owner of command history shared by mounted actions.
    const previous = cache.build(
      client,
      { mutationKey: key },
      { ...state, status: "success", data: denied },
    );
    const failed = cache.build(
      client,
      { mutationKey: key },
      { ...state, status: "error", error: new Error("offline") },
    );
    const pending = cache.build(
      client,
      { mutationKey: key },
      { ...state, status: "pending" },
    );
    const other = cache.build(
      client,
      { mutationKey: [...key, "another"] },
      { ...state, status: "success", data: denied },
    );
    const otherAccount = cache.build(
      client,
      { mutationKey: ["reading-progress", "b", "set-state", materialId] },
      { ...state, status: "success", data: denied },
    );
    const unavailable = cache.build(
      client,
      { mutationKey: key },
      { ...state, status: "success", data: { kind: "unavailable" } },
    );
    const value = {
      accountId: "a",
      states: new Map([[materialId, { isRead: false, version: 1 }]]),
      failed: false,
      refresh: () => Promise.resolve(),
      register: () => () => undefined,
    };
    function show(resolved: boolean, canMark: boolean) {
      flushSync(() => {
        root.render(
          <QueryClientProvider client={client}>
            <MaterialReadingScope value={{ ...value, resolved }}>
              <SavedReadingAction
                materialId={materialId}
                format="guide"
                canMark={canMark}
              />
            </MaterialReadingScope>
          </QueryClientProvider>,
        );
      });
    }
    try {
      show(false, true);
      await expect(cache.getAll()).toContain(previous);
      show(true, false);
      await expect(cache.getAll()).toContain(previous);
      show(true, true);
      await waitFor(() => expect(cache.getAll()).not.toContain(previous));
      await expect(cache.getAll()).toEqual([
        failed,
        pending,
        other,
        otherAccount,
        unavailable,
      ]);
      await expect(within(host).getByRole("button")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      cache.remove(pending);
      const newDenial = cache.build(
        client,
        { mutationKey: key },
        { ...state, status: "success", data: denied },
      );
      await waitFor(() =>
        expect(within(host).getByRole("button")).toHaveAttribute(
          "aria-disabled",
          "true",
        ),
      );
      await expect(cache.getAll()).toContain(newDenial);
    } finally {
      root.unmount();
      host.remove();
      client.clear();
    }
  },
};
