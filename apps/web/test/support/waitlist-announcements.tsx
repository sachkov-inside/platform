import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaterialReadingScope } from "@/entities/material";
import {
  productWaitlistChanges,
  useProductWaitlist,
} from "@/features/product-waitlist";

const accountA = "00000000-0000-4000-8000-000000000001";
const accountB = "00000000-0000-4000-8000-000000000002";
const productA = "10000000-0000-4000-8000-000000000001";
const productB = "10000000-0000-4000-8000-000000000002";
const primary = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
const secondary = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

function Status({
  name,
  productId,
}: {
  readonly name: string;
  readonly productId: string;
}) {
  const { query } = useProductWaitlist(productId);
  return (
    <output aria-label={name}>
      {query.data?.kind === "ready"
        ? `${query.data.accountId}:${query.data.intakeId}:${String(query.data.active)}`
        : "loading"}
    </output>
  );
}
function App() {
  const [accountId, setAccountId] = useState(accountA);
  const [productId, setProductId] = useState(productA);
  return (
    <>
      <button
        onClick={() => {
          setAccountId(accountB);
        }}
      >
        Switch Account
      </button>
      <button
        onClick={() => {
          setProductId(productB);
        }}
      >
        Switch Product
      </button>
      <button
        onClick={() => {
          productWaitlistChanges(accountId, productId).announce();
        }}
      >
        Announce write
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
        <QueryClientProvider client={primary}>
          <Status name="Primary" productId={productId} />
          <Status name="Same cache" productId={productId} />
        </QueryClientProvider>
        {new URLSearchParams(window.location.search).has("secondary") ? (
          <QueryClientProvider client={secondary}>
            <Status name="Independent cache" productId={productId} />
          </QueryClientProvider>
        ) : null}
      </MaterialReadingScope>
    </>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
