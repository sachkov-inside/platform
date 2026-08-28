import type { Metadata } from "next";

import { MaterialAuthoringPage } from "@/_pages/material-authoring.server";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Новый материал",
};

export default MaterialAuthoringPage;
