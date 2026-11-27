import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckoutFlow } from "@/features/billing-checkout/ui/checkout-flow.client";
import {
  legalDocuments,
  productWithSupportOffer,
  supportOffer,
  verifiedContact,
} from "../fixtures/billing.fixtures";

const client = new QueryClient();

function Fixture() {
  const [snapshot, setSnapshot] = useState(supportOffer);
  return (
    <QueryClientProvider client={client}>
      <button
        onClick={() => {
          setSnapshot(productWithSupportOffer);
        }}
      >
        Вариант B
      </button>
      <CheckoutFlow
        snapshot={snapshot}
        contact={verifiedContact}
        documents={legalDocuments}
      />
    </QueryClientProvider>
  );
}

const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
createRoot(host).render(<Fixture />);
