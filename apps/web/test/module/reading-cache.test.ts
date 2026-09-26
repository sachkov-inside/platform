import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { clearOtherReadingAccounts } from "@/features/reading-progress/model/reading-cache";
it("removes query AND mutation data on Account changes and sign-out without touching public data", () => {
  const client = new QueryClient();
  client.setQueryData(
    [
      "reading-progress",
      "first",
      "material",
      "72000000-0000-4000-8000-000000000020",
    ],
    [{ isRead: true }],
  );
  client.setQueryData(
    [
      "reading-progress",
      "second",
      "material",
      "72000000-0000-4000-8000-000000000020",
    ],
    [{ isRead: false }],
  );
  client.setQueryData(["library"], ["public"]);
  for (const account of ["first", "second"])
    client.getMutationCache().build(
      client,
      { mutationKey: ["reading-progress", account, "set-state"] },
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
      "reading-progress",
      "first",
      "material",
      "72000000-0000-4000-8000-000000000020",
    ]),
  ).toBeUndefined();
  expect(
    client.getQueryData([
      "reading-progress",
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
  ).toEqual([["reading-progress", "second", "set-state"]]);
  clearOtherReadingAccounts(client, null);
  expect(
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey),
  ).toEqual([["library"]]);
  expect(client.getMutationCache().getAll()).toEqual([]);
  client.clear();
});
