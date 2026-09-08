import { Body, Controller, Inject, Put } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation } from "@nestjs/swagger";
import { z } from "zod";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { parseMaterialAuthoringBody, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import { homePinSchema } from "../load-home-pin/home-pin-http.js";

const bodySchema = z.object({ materialId: z.uuid().nullable(), expectedVersion: z.number().int().positive() }).strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/home-pin")
export class SetHomePinController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Put()
  @ApiOperation({ operationId: "setAuthoringHomePin", summary: "Replace or remove the author's Home Material selection" })
  @ApiBody({ schema: toOpenApiSchema(bodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(homePinSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async set(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const result = await this.authoring.setHomePin({ actor: account.accountId, ...parseMaterialAuthoringBody(bodySchema, input) });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
