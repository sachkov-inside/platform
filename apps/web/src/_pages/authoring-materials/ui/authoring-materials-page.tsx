import { Suspense } from "react";

import { AuthoringMaterialsLoading } from "./authoring-materials-view";
import { AuthoringMaterialsPageQuery } from "./authoring-materials-page-query.client";

export { AuthoringMaterialsLoading };

export function AuthoringMaterialsPage() {
  return (
    <Suspense fallback={<AuthoringMaterialsLoading />}>
      <AuthoringMaterialsPageQuery />
    </Suspense>
  );
}
