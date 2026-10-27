import { Suspense } from "react";

import { AuthoringPeopleLoading } from "./authoring-people-loading";
import { AuthoringPeoplePageQuery } from "./authoring-people-page-query.client";

export { AuthoringPeopleLoading };

/** `/authoring/people`: фильтры живут в адресе, список читает браузер (одна фабрика запроса). */
export function AuthoringPeoplePage() {
  return (
    <Suspense fallback={<AuthoringPeopleLoading />}>
      <AuthoringPeoplePageQuery />
    </Suspense>
  );
}
