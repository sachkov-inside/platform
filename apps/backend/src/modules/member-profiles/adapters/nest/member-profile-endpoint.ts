import { applyDecorators } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent } from "../../../../infrastructure/http/zod-openapi.js";
import { accountProblemSchema } from "../../../accounts/index.js";
import { memberProfileProblemSchema } from "./member-profile-http.contract.js";

export function MemberProfileEndpoint(): ClassDecorator {
  return applyDecorators(ApiTags("Member Profiles"), PrivateNoStore());
}

export function ApiMemberProfileErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        content: problemDetailsContent(problemSchemaFor(status)),
      }),
    ),
  );
}

function problemSchemaFor(status: number) {
  if (status === 401 || status === 503) return accountProblemSchema;
  if (status === 500) {
    return z.union([memberProfileProblemSchema, accountProblemSchema]);
  }
  return memberProfileProblemSchema;
}
