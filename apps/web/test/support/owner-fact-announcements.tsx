import { useState } from "react";
import { z } from "zod";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ownerPriceCatalogChanged,
  useOwnerPriceCatalog,
} from "@/entities/subscription";
import { useCatalogSale } from "@/features/product-sale-settings";
import { productSaleChanged } from "@/features/product-sale-settings/model/product-sale-events";

import { CourseActivationRulesPanel } from "@/features/course-activation-rules";
import { activationRulesChanged } from "@/features/course-activation-rules/model/activation-rule-events";
import {
  PromotionsPanel,
  defaultPromotionsFilter,
} from "@/features/promotions";
import { promotionsChanged } from "@/features/promotions/model/promotion-events";

const kind = z
  .enum(["catalog", "sale", "rules", "promotions"])
  .parse(new URLSearchParams(window.location.search).get("kind") ?? "catalog");
const announcement = {
  catalog: ownerPriceCatalogChanged,
  sale: productSaleChanged,
  rules: activationRulesChanged,
  promotions: promotionsChanged,
}[kind];

const primary = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const secondary = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function CatalogPrice() {
  const query = useOwnerPriceCatalog();
  return query.data?.archivedProductIds.length ?? "loading";
}
function CatalogSale() {
  const sale = useCatalogSale();
  return sale.kind === "loading"
    ? "loading"
    : (sale.reads.salesStates?.get("10000000-0000-4000-8000-000000000001")
        ?.revision ?? "unknown");
}
function Rules() {
  return (
    <CourseActivationRulesPanel
      productId="10000000-0000-4000-8000-000000000001"
      productName="Synthetic product"
    />
  );
}
function Promotions() {
  const [filter, setFilter] = useState(defaultPromotionsFilter);
  return <PromotionsPanel filter={filter} onFilterChange={setFilter} />;
}
const Catalog = {
  catalog: CatalogPrice,
  sale: CatalogSale,
  rules: Rules,
  promotions: Promotions,
}[kind];
function App() {
  return (
    <>
      <button
        onClick={() => {
          announcement.announce();
        }}
      >
        Announce write
      </button>
      <QueryClientProvider client={primary}>
        <section aria-label="Primary">
          <Catalog />
        </section>
        <section aria-label="Same cache">
          <Catalog />
        </section>
      </QueryClientProvider>
      {new URLSearchParams(window.location.search).has("secondary") ? (
        <QueryClientProvider client={secondary}>
          <section aria-label="Independent cache">
            <Catalog />
          </section>
        </QueryClientProvider>
      ) : null}
    </>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
