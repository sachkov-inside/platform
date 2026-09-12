import type { Metadata } from "next";

import { LegalSectionPage } from "@/_pages/legal";
import { legalSectionView } from "@/_pages/legal.server";

export const metadata: Metadata = {
  title: "Документы",
  description:
    "Условия использования, оферты, обработка персональных данных и реквизиты продавца Sachkov Inside.",
};

/** Публичный юридический раздел: открыт без входа и без оплаты. */
export default function LegalSectionRoute() {
  return <LegalSectionPage editions={legalSectionView()} />;
}
