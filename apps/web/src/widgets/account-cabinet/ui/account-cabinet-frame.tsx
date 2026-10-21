import { AccountCabinet } from "./account-cabinet.client";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";

/** Серверная рамка кабинета продуктов. Подписки сейчас не предлагаются. */
export function AccountCabinetFrame({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <AccountCabinet options={[]}>
      {/* Documents are available inline in the cabinet. */}
      <HidePublicFooter />
      {children}
    </AccountCabinet>
  );
}
