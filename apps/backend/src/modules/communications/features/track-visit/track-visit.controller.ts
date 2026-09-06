import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { TrackVisit, trackingInputSchema, trackingResultSchema } from "./track-visit.js";

@ApiTags("Communications tracking")
@PrivateNoStore()
@Controller("communications/tracking")
export class TrackVisitController {
  constructor(@Inject(TrackVisit) private readonly visits: TrackVisit) {}
  @Post("resolve")
  @HttpCode(200)
  @ApiOperation({ operationId: "resolveCommunicationVisit", summary: "Resolve an opaque public link and persist a visit without granting content access", security: [] })
  @ApiBody({ schema: toOpenApiSchema(trackingInputSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(trackingResultSchema) })
  resolve(@Body() body: unknown) { return this.visits.resolve(body); }
}
