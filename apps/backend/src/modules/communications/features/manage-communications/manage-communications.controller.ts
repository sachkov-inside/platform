import { Body, Controller, HttpCode, HttpException, Inject, Post, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { communicationsFailureSchema, communicationsResultSchema, managementRequestSchema, type CommunicationsResult } from "../../communications-contract.js";
import { Communications } from "../../facets/communications/communications.js";
import { templateReferenceSchema } from "./template-reference.js";

const problemSchema = z.object({ type: z.string(), title: z.string(), status: z.number().int(), code: communicationsFailureSchema.shape.error.shape.code });
const templateLookupSchema = z.strictObject({ reference: z.string().min(1).max(2048), operationId: z.guid() });

@ApiTags("Communications")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 400, content: problemDetailsContent(problemSchema) })
@ApiResponse({ status: 403, content: problemDetailsContent(problemSchema) })
@ApiResponse({ status: 404, content: problemDetailsContent(problemSchema) })
@ApiResponse({ status: 409, content: problemDetailsContent(problemSchema) })
@ApiResponse({ status: 422, content: problemDetailsContent(problemSchema) })
@ApiResponse({ status: 501, content: problemDetailsContent(problemSchema) })
@ApiResponse({ status: 502, content: problemDetailsContent(problemSchema) })
@ApiResponse({ status: 503, content: problemDetailsContent(problemSchema) })
@Controller("communications")
export class ManageCommunicationsController {
  constructor(@Inject(Communications) private readonly communications: Communications) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "manageCommunications", summary: "Manage Telegram communications as the authenticated Account" })
  @ApiBody({ schema: toOpenApiSchema(managementRequestSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(communicationsResultSchema) })
  async execute(@CurrentAccount() account: AuthenticatedAccount, @Body() body: unknown) {
    return toHttpResult(await this.communications.execute(account.accountId, body));
  }

  @Post("templates/resolve")
  @HttpCode(200)
  @ApiOperation({ operationId: "resolveCommunicationsTemplate", summary: "Read an authorized template by ID or reference link without fetching the link" })
  @ApiBody({ schema: toOpenApiSchema(templateLookupSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(communicationsResultSchema) })
  async resolveTemplate(@CurrentAccount() account: AuthenticatedAccount, @Body() body: unknown) {
    const parsed = templateLookupSchema.safeParse(body);
    const reference = templateReferenceSchema.safeParse(parsed.success ? parsed.data.reference : undefined);
    if (!parsed.success || !reference.success) return toHttpResult({ ok: false, error: { code: "invalid_input" } });
    return toHttpResult(await this.communications.execute(account.accountId, {
      contractVersion: "inside-communications-v1", operation: "templates.read", operationId: parsed.data.operationId,
      expectedRevision: 0, payload: { templateId: reference.data },
    }));
  }
}

function toHttpResult(result: CommunicationsResult) {
  if (result.ok) return result;
  const statuses = {
    forbidden: 403, invalid_input: 400, link_required: 409, authorization_unavailable: 503,
    provider_unavailable: 503, provider_invalid_response: 502, unauthorized: 502,
    not_found: 404, malformed: 400, unsupported_content: 422, revision_conflict: 409,
    operation_conflict: 409, not_implemented: 501,
  } as const;
  throw new HttpException({ code: result.error.code }, statuses[result.error.code]);
}
