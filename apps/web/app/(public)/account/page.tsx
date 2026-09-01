import type { Metadata } from "next";
import { AccountPageQuery } from "@/_pages/account";
import { QueryProvider } from "@/_app";

export const metadata: Metadata = {
  title: "Аккаунт",
  robots: { follow: false, index: false },
};

export default function AccountRoute() {
  return (
    <QueryProvider>
      <AccountPageQuery />
    </QueryProvider>
  );
}
