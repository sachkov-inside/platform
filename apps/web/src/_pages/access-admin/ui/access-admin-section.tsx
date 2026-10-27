import type { PriceSnapshot } from "@/entities/subscription";
import { ProductAccessPanel } from "@/features/billing-admin";
import { AccessSection } from "./access-section.client";
export function AccessAdminSection({
  offers: _offers,
}: {
  readonly offers: readonly PriceSnapshot[];
}) {
  return (
    <AccessSection
      tabs={[
        {
          id: "products",
          label: "Доступ к продуктам",
          panel: <ProductAccessPanel />,
        },
      ]}
    />
  );
}
