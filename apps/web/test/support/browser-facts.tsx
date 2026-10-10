import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaterialReadingScope } from "@/entities/material";
import { SavedBookmarkAction } from "@/features/bookmarks";
import {
  ReadingProgressProvider,
  SavedReadingAction,
} from "@/features/reading-progress";
import { BookmarksPageQuery } from "@/_pages/bookmarks";
import { PeoplePanel } from "@/features/billing-admin/ui/people-panel.client";
import { InvitationsPanel } from "@/features/billing-admin/ui/invitations-panel.client";
import { AccessSummaryPanel } from "@/features/billing-admin/ui/access-summary-panel.client";
import { materialsOffer } from "@/storybook/billing.fixtures";

// The main surface has the production query cache. Secondary surfaces use an independent
// recipient cache to prove window announcements without the writer's local invalidation.
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
const secondaryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
function BrowserFacts() {
  const [accountId, setAccountId] = useState(
    "00000000-0000-4000-8000-000000000001",
  );
  return (
    <QueryClientProvider client={client}>
      <button
        onClick={() => {
          setAccountId("00000000-0000-4000-8000-000000000002");
        }}
      >
        Switch Account
      </button>
      <MaterialReadingScope
        value={{
          accountId,
          resolved: true,
          states: new Map(),
          failed: false,
          register: () => () => undefined,
          refresh: () => Promise.resolve(),
        }}
      >
        <section aria-label="Bookmark action">
          <SavedBookmarkAction materialId="10000000-0000-4000-8000-000000000001" />
        </section>
        <section aria-label="Bookmark list">
          <BookmarksPageQuery />
        </section>
        <section aria-label="People">
          <PeoplePanel offers={[materialsOffer]} />
        </section>
        <section aria-label="Invitations">
          <InvitationsPanel offers={[materialsOffer]} />
        </section>
        <section aria-label="Summary">
          <AccessSummaryPanel />
        </section>
        {new URLSearchParams(window.location.search).has("secondary") ? (
          <QueryClientProvider client={secondaryClient}>
            <section aria-label="Secondary bookmark list">
              <BookmarksPageQuery />
            </section>
            <section aria-label="Secondary People">
              <PeoplePanel offers={[materialsOffer]} />
            </section>
            <section aria-label="Secondary Invitations">
              <InvitationsPanel offers={[materialsOffer]} />
            </section>
            <section aria-label="Secondary Summary">
              <AccessSummaryPanel />
            </section>
          </QueryClientProvider>
        ) : null}
      </MaterialReadingScope>
    </QueryClientProvider>
  );
}

/** Uses the real account-scoped read owner; only HTTP responses are supplied by the test. */
function ReadingFacts() {
  const action = (name: string, queryClient: QueryClient) => (
    <QueryClientProvider client={queryClient}>
      <ReadingProgressProvider
        accountId="00000000-0000-4000-8000-000000000001"
        resolved
      >
        <section aria-label={name}>
          <SavedReadingAction
            format="guide"
            materialId="10000000-0000-4000-8000-000000000001"
          />
        </section>
      </ReadingProgressProvider>
    </QueryClientProvider>
  );
  return (
    <>
      {action("Reading action", client)}
      {new URLSearchParams(window.location.search).has("secondary")
        ? action("Secondary reading action", secondaryClient)
        : null}
    </>
  );
}
const root = document.getElementById("root");
if (root === null) throw new Error("Missing browser facts root");
createRoot(root).render(
  new URLSearchParams(window.location.search).has("reading") ? (
    <ReadingFacts />
  ) : (
    <BrowserFacts />
  ),
);
