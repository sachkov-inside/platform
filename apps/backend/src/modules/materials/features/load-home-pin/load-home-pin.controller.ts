import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import { homePinSchema } from "./home-pin-http.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/home-pin")
export class LoadHomePinController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Get()
  @ApiOperation({ operationId: "loadAuthoringHomePin", summary: "Read the author's Home Material selection" })
  @ApiOkResponse({ schema: toOpenApiSchema(homePinSchema) })
  @ApiMaterialAuthoringErrors(401, 403, 500, 503)
  async load(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.authoring.loadHomePin({ actor: account.accountId });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
