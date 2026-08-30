import type { Metadata } from "next";

import { AccountPage } from "@/_pages/account.server";

export const metadata: Metadata = {
  title: "Аккаунт",
  robots: { follow: false, index: false },
};

export default AccountPage;
