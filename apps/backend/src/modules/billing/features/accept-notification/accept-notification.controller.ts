import { Body, Controller, Header, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { BillingPayments } from "../../facets/billing-payments/billing-payments.js";
import { throwPaymentError } from "../../shared/payment-http.filter.js";
@ApiTags("Billing")
@PrivateNoStore()
@Controller("billing/tbank/notification")
export class AcceptTbankNotificationController {
  constructor(@Inject(BillingPayments) private readonly payments: BillingPayments) {}
  @Post()
  @HttpCode(200)
  @Header("Content-Type", "text/plain")
  @ApiOperation({ operationId: "acceptTbankNotification", summary: "Durably accept a signed bank notification", security: [] })
  @ApiBody({ schema: { type: "object", required: ["Token", "TerminalKey", "PaymentId", "OrderId", "Amount", "Status", "Success", "ErrorCode"], properties: { Token: { type: "string", minLength: 64, maxLength: 64 }, TerminalKey: { type: "string" }, PaymentId: { oneOf: [{ type: "string" }, { type: "integer" }] }, OrderId: { type: "string" }, Amount: { type: "integer" }, Status: { type: "string" }, Success: { type: "boolean" }, ErrorCode: { type: "string" } }, additionalProperties: true } })
  @ApiOkResponse({ content: { "text/plain": { schema: { type: "string", enum: ["OK"] } } } })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_notification"])) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["dependency_unavailable"])) })
  async accept(@Body() input: unknown) {
    const result = await this.payments.notification(input);
    if (!result.ok) throwPaymentError(result.error.code);
    return "OK";
  }
}
