import type { Metadata } from "next";
import { AccountPageQuery } from "@/_pages/account";

export const metadata: Metadata = {
  title: "Профиль",
};

export default function AccountRoute() {
  return <AccountPageQuery />;
}
