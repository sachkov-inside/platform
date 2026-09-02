import type { ReactNode } from "react";

import { QueryProvider } from "@/_app";

export default function CatalogLayout({ children }: { readonly children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
