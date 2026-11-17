import { CancelledError, QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { clearOtherReadingAccounts } from "@/features/reading-progress/model/reading-cache";
it.each(["reading-progress", "bookmarks"])(
  "removes %s query and mutation data on Account changes and sign-out without touching public data",
  (family) => {
    const client = new QueryClient();
    client.setQueryData(
      [family, "first", "material", "72000000-0000-4000-8000-000000000020"],
      [{ isRead: true }],
    );
    client.setQueryData(
      [family, "second", "material", "72000000-0000-4000-8000-000000000020"],
      [{ isRead: false }],
    );
    client.setQueryData(["library"], ["public"]);
    for (const account of ["first", "second"])
      client.getMutationCache().build(
        client,
        { mutationKey: [family, account, "set-state"] },
        {
          context: undefined,
          data: { isRead: true },
          error: null,
          failureCount: 0,
          failureReason: null,
          isPaused: false,
          status: "success",
          variables: { commandId: "personal" },
          submittedAt: 1,
        },
      );
    clearOtherReadingAccounts(client, "second");
    expect(
      client.getQueryData([
        family,
        "first",
        "material",
        "72000000-0000-4000-8000-000000000020",
      ]),
    ).toBeUndefined();
    expect(
      client.getQueryData([
        family,
        "second",
        "material",
        "72000000-0000-4000-8000-000000000020",
      ]),
    ).toEqual([{ isRead: false }]);
    expect(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.options.mutationKey),
    ).toEqual([[family, "second", "set-state"]]);
    clearOtherReadingAccounts(client, null);
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([["library"]]);
    expect(client.getMutationCache().getAll()).toEqual([]);
    client.clear();
  },
);

it("cancels a former Account bookmark read before its late answer can refill the cache", async () => {
  const client = new QueryClient();
  const started = Promise.withResolvers<undefined>();
  const answer = Promise.withResolvers<{ bookmarked: boolean }>();
  const queryKey = ["bookmarks", "former", "states", "material"] as const;
  const read = client.query({
    queryKey,
    queryFn: () => {
      started.resolve(undefined);
      return answer.promise;
    },
  });
  const settled = read.then(
    () => "completed",
    (error: unknown) =>
      error instanceof CancelledError ? "cancelled" : "failed",
  );
  try {
    await started.promise;
    clearOtherReadingAccounts(client, "current");
    answer.resolve({ bookmarked: false });
    expect(await settled).toBe("cancelled");
    expect(client.getQueryData(queryKey)).toBeUndefined();
  } finally {
    answer.resolve({ bookmarked: false });
    await settled;
    client.clear();
  }
});
