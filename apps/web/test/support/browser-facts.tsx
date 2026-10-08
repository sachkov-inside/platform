import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaterialReadingScope } from "@/entities/material";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { BookmarksPageQuery } from "@/_pages/bookmarks";
import { PeoplePanel } from "@/features/billing-admin/ui/people-panel.client";
import { InvitationsPanel } from "@/features/billing-admin/ui/invitations-panel.client";
import { AccessSummaryPanel } from "@/features/billing-admin/ui/access-summary-panel.client";
import { materialsOffer } from "@/storybook/billing.fixtures";

// One document has one real browser query cache, just as the production shell does.
const client = new QueryClient({
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
      </MaterialReadingScope>
      <section aria-label="People">
        <PeoplePanel offers={[materialsOffer]} />
      </section>
      <section aria-label="Invitations">
        <InvitationsPanel offers={[materialsOffer]} />
      </section>
      <section aria-label="Summary">
        <AccessSummaryPanel />
      </section>
    </QueryClientProvider>
  );
}
const root = document.getElementById("root");
if (root === null) throw new Error("Missing browser facts root");
createRoot(root).render(<BrowserFacts />);
