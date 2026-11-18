import { useState } from "react";
import { z } from "zod";
import {
  useProductCommunityEntry,
  announceProductCommunityChange,
} from "@/features/community-entry";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { announceEnrollmentChange } from "@/entities/subscription";
import {
  useCurrentBilling,
  announceCurrentBillingChange,
} from "@/features/billing-subscription";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const secondary = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const parameters = new URLSearchParams(window.location.search);
const enabled = !parameters.has("disabled");
function Billing() {
  const query = useCurrentBilling({ enabled });
  return (
    <span data-fetch-status={query.fetchStatus}>
      {query.data?.ok === true
        ? (query.data.value.products[0]?.name ?? "Empty")
        : "Loading"}
    </span>
  );
}
const kind = z
  .enum(["billing", "community"])
  .parse(parameters.get("kind") ?? "billing");
function Community({
  productId = "60000000-0000-4000-8000-000000000001",
}: {
  readonly productId?: string;
}) {
  const query = useProductCommunityEntry(
    productId,
    "60000000-0000-4000-8000-000000000002",
    enabled,
  );
  return (
    <span data-fetch-status={query.fetchStatus}>
      {query.data?.ok === true ? query.data.value.kind : "Loading"}
    </span>
  );
}
const Status = kind === "billing" ? Billing : Community;
function App() {
  const [inspection, setInspection] = useState(0);
  return (
    <QueryClientProvider client={client}>
      <button
        onClick={() => {
          if (kind === "community") announceProductCommunityChange();
          else if (parameters.has("enrollment")) announceEnrollmentChange();
          else announceCurrentBillingChange();
        }}
      >
        Announce write
      </button>
      <button
        onClick={() => {
          setInspection((value) => value + 1);
        }}
      >
        Inspect readers
      </button>
      <output aria-label="Inspection">{inspection}</output>
      <output aria-label="Primary">
        <Status />
      </output>
      <output aria-label="Same cache">
        <Status />
      </output>
      {parameters.has("other") ? (
        <output aria-label="Other Product">
          <Community productId="60000000-0000-4000-8000-000000000003" />
        </output>
      ) : null}
      {parameters.has("secondary") ? (
        <QueryClientProvider client={secondary}>
          <output aria-label="Independent cache">
            <Status />
          </output>
        </QueryClientProvider>
      ) : null}
    </QueryClientProvider>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
