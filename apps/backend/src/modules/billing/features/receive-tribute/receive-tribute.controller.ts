import { tributeWebhookSchema } from "../../../membership-entitlements/index.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Controller, Headers, HttpCode, HttpException, Inject, Post, Req, type RawBodyRequest } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { TributeConvergence } from "../../facets/tribute-convergence/tribute-convergence.js";
import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";

export const tributeAcknowledgementSchema = z.strictObject({ ok: z.literal(true), receiptRef: z.uuid(),
  status: z.enum(["applied", "duplicate", "pending_reconciliation", "rejected", "received"]) });
@ApiTags("Tribute integration")
@ApiSecurity("tribute-signature")
@PrivateNoStore()
@Controller("integrations/tribute/v1/webhook")
export class ReceiveTributeController {
  constructor(@Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
    @Inject(TributeConvergence) private readonly tribute: TributeConvergence) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "receiveTributeWebhook", summary: "Durably accept the official raw-body signed Tribute event; unsupported facts require reconciliation" })
  @ApiBody({ schema: toOpenApiSchema(tributeWebhookSchema), description: "Official Tribute envelope. Signed unsupported schemas are retained as pending_reconciliation without access." })
  @ApiOkResponse({ schema: toOpenApiSchema(tributeAcknowledgementSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ["invalid_signature"])) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["tribute_unavailable"])) })
  async receive(@Headers("trbt-signature") signature: string | undefined, @Req() request: RawBodyRequest<FastifyRequest>) {
    const config = this.config.tribute;
    if (config === undefined) throw new HttpException({ code: "tribute_unavailable" }, 503);
    const raw = request.rawBody;
    const encoded = signature ?? "";
    const validShape = config.signatureEncoding === "hex" ? /^[a-fA-F0-9]{64}$/u.test(encoded) : /^[A-Za-z0-9+/]{43}=$/u.test(encoded);
    if (!raw || !validShape) throw new HttpException({ code: "invalid_signature" }, 401);
    const supplied = Buffer.from(encoded, config.signatureEncoding);
    const expected = createHmac("sha256", config.apiKey).update(raw).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpException({ code: "invalid_signature" }, 401);
    try {
      const result = await this.tribute.receive(raw, request.body);
      return { ok: true as const, receiptRef: result.value.id, status: result.duplicate ? "duplicate" as const : result.value.state };
    } catch (error) { reportDependencyFailure({ module: "billing", operation: "receive" }, error); throw new HttpException({ code: "tribute_unavailable" }, 503); }
  }
}
