import { bankNotificationSchema } from "../../infrastructure/tbank/tbank.js";
import { BankAcknowledgementInterceptor } from "../../adapters/nest/bank-acknowledgement.interceptor.js";
import { Body, Controller, HttpCode, Inject, Post, UseInterceptors } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { BillingPayments } from "../../facets/billing-payments/billing-payments.js";
import { throwPaymentError } from "../../shared/payment-http.filter.js";
@ApiTags("Billing")
@PrivateNoStore()
@Controller("billing/tbank/notification")
export class AcceptTbankNotificationController {
  constructor(@Inject(BillingPayments) private readonly payments: BillingPayments) {}
  @Post()
  @HttpCode(200)
  @UseInterceptors(BankAcknowledgementInterceptor)
  @ApiOperation({ operationId: "acceptTbankNotification", summary: "Durably accept a signed bank notification", security: [] })
  @ApiBody({ schema: toOpenApiSchema(bankNotificationSchema) })
  @ApiOkResponse({ content: { "text/plain": { schema: { type: "string", enum: ["OK"] } } } })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_notification"])) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["dependency_unavailable"])) })
  async accept(@Body() input: unknown) {
    const result = await this.payments.notification(input);
    if (!result.ok) throwPaymentError(result.error.code);
    return "OK";
  }
}
