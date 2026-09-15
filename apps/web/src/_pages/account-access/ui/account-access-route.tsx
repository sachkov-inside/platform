import { currentLegalEdition } from "@inside/legal";

import { legalEditionPath } from "@/shared/routing/public-page-path";

import { AccountAccessPage } from "./account-access-page.client";

/** Серверная сборка раздела «Аккаунт»: действующие редакции документов о данных. */
export function AccountAccessRoute() {
  const policies = (["privacy", "cookies"] as const).map((key) => {
    const { version } = currentLegalEdition(key);
    return {
      label: `${key === "privacy" ? "политика" : "cookies"}, редакция ${String(version)}`,
      href: legalEditionPath(key, version),
    };
  });
  return <AccountAccessPage policies={policies} />;
}
