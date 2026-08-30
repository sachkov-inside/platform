import type { Metadata } from "next";

import { AuthoringMaterialsPage } from "@/_pages/authoring-materials.server";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Материалы · Authoring",
};

export default AuthoringMaterialsPage;
