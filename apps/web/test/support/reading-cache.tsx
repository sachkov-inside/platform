import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MaterialReadingScope } from "@/entities/material";
import { ReadingProgressProvider } from "@/features/reading-progress/ui/reading-provider.client";
import { SavedReadingAction } from "@/features/reading-progress/ui/saved-reading-action.client";

const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
const root = createRoot(host);
const client = new QueryClient();
const replacement = new QueryClient();

const materialId = "72000000-0000-4000-8000-000000000020";
const key = ["reading-progress", "a", "set-state", materialId];
const otherKey = ["reading-progress", "b", "set-state", materialId];
const cache = client.getMutationCache();
const mutations = new Map<string, number>();
let releasePending: (() => void) | undefined;
const reading = {
  accountId: "a",
  states: new Map([[materialId, { isRead: false, version: 1 }]]),
  failed: false,
  refresh: () => Promise.resolve(),
  register: () => () => undefined,
};

function addMutation(
  name: string,
  status: "success" | "pending" | "error",
  kind: "denied" | "unavailable",
  mutationKey: readonly string[] = key,
) {
  const command = cache.build(
    client,
    { mutationKey },
    {
      context: undefined,
      data: status === "success" ? { kind } : undefined,
      error: status === "error" ? new Error("offline") : null,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
      variables: undefined,
      submittedAt: 1,
      status,
    },
  );
  mutations.set(name, command.mutationId);
  return () => {
    cache.remove(command);
  };
}

function showAction(resolved: boolean, canMark: boolean) {
  flushSync(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MaterialReadingScope value={{ ...reading, resolved }}>
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

function showProvider(
  account: string | null,
  resolved: boolean,
  replace = false,
) {
  flushSync(() => {
    root.render(
      <QueryClientProvider client={replace ? replacement : client}>
        <ReadingProgressProvider accountId={account} resolved={resolved}>
          <span>Reader provider</span>
        </ReadingProgressProvider>
      </QueryClientProvider>,
    );
  });
}

function signOut(path: string) {
  const form = document.createElement("form");
  form.action = path;
  const bookmarkKey = ["bookmarks", "b"];
  const query = ["library"];
  let privateAtSubmit: unknown = null;
  replacement.setQueryData(bookmarkKey, "private");
  replacement.setQueryData(query, "public");
  form.addEventListener("submit", (event) => {
    privateAtSubmit = replacement.getQueryData(bookmarkKey);
    event.preventDefault();
  });
  document.body.append(form);
  try {
    form.requestSubmit();
    return { privateAtSubmit, publicAfter: replacement.getQueryData(query) };
  } finally {
    form.remove();
  }
}

Object.assign(window, {
  readingCacheFixture: {
    seed() {
      addMutation("previous", "success", "denied");
      addMutation("failed", "error", "denied");
      releasePending = addMutation("pending", "pending", "denied");
      addMutation("other", "success", "denied", [...key, "another"]);
      addMutation("otherAccount", "success", "denied", otherKey);
      addMutation("unavailable", "success", "unavailable");
    },
    completePending() {
      releasePending?.();
      addMutation("newDenial", "success", "denied");
    },
    mutationNames: () => {
      const present = new Set(
        cache.getAll().map(({ mutationId }) => mutationId),
      );
      return Array.from(mutations.entries())
        .filter(([, id]) => present.has(id))
        .map(([name]) => name);
    },
    showAction,
    showProvider,
    signOut,
    unmount: () => {
      root.unmount();
    },
    async resolveObsoleteRead() {
      const queryKey = ["reading-progress", "a", "material", materialId];
      const entered = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<string>();
      showProvider("a", true);
      const receipt = client
        .query({
          queryKey,
          queryFn: () => {
            entered.resolve(undefined);
            return release.promise;
          },
        })
        .catch(() => "cancelled");
      await entered.promise;
      showProvider(null, false);
      const unresolved = client.getQueryState(queryKey)?.fetchStatus;
      showProvider("b", true);
      release.resolve("obsolete");
      return {
        unresolved,
        receipt: await receipt,
        data: client.getQueryData(queryKey),
      };
    },
  },
});
