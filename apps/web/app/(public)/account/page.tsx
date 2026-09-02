import type { Metadata } from "next";
import { AccountPageQuery } from "@/_pages/account";

export const metadata: Metadata = {
  title: "Аккаунт",
  robots: { follow: false, index: false },
};

export default function AccountRoute() {
  return <AccountPageQuery />;
}
