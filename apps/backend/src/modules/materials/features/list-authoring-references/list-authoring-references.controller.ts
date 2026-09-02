import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation } from "@nestjs/swagger";
import { z } from "zod";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import { throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

const referenceSchema = z
  .object({ archived: z.boolean(), id: z.uuid(), name: z.string().min(1) })
  .strict();
const responseSchema = z
  .object({
    formats: z.array(referenceSchema),
    series: z.array(referenceSchema),
    tags: z.array(referenceSchema),
    topics: z.array(referenceSchema),
  })
  .strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class ListAuthoringReferencesController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Get("references")
  @ApiOperation({
    operationId: "listMaterialAuthoringReferences",
    summary: "List the reference values available to a Material author",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(responseSchema) })
  @ApiMaterialAuthoringErrors(401, 403, 500, 503)
  async list(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.authoring.listReferences({ actor: account.accountId });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return result.value;
  }
}
