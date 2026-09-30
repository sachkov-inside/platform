import {
  Controller,
  Get,
  Inject,
  Param,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  accountId as checkedAccountId,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  CONTENT_ACCESS,
  type ContentAccess,
} from "../../../content-access/index.js";

const guideIdSchema = z.uuid().toLowerCase();
const guideAccessHttpSchema = z
  .object({ access: z.enum(["open", "closed"]) })
  .strict();

/**
 * Открыт ли продукт текущему Account: первый экран продукта прячет оплату от того, у кого он уже
 * есть, даже пока у продукта нет ни одного опубликованного платного материала (#831).
 */
@ApiTags("Content library")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("accounts/current/guides")
export class ReadGuideAccessController {
  constructor(
    @Inject(CONTENT_ACCESS)
    private readonly contentAccess: Pick<ContentAccess, "checkGuideAccess">,
  ) {}

  @Get(":guideId/access")
  @ApiOperation({
    operationId: "readCurrentAccountGuideAccess",
    summary: "Read whether the current Account's grounds open a Guide",
  })
  @ApiParam({ name: "guideId", schema: toOpenApiSchema(guideIdSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(guideAccessHttpSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(400, ["invalid_request"]),
      accountProblemSchema,
    ),
  })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
      accountProblemSchema,
    ),
  })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("guideId") guideId: string,
  ): Promise<z.infer<typeof guideAccessHttpSchema>> {
    const parsed = guideIdSchema.safeParse(guideId);
    if (!parsed.success)
      throw problemException(400, "invalid_request", "Invalid Guide id");
    const result = await this.contentAccess.checkGuideAccess({
      subject: {
        kind: "account",
        accountId: checkedAccountId(current.accountId),
      },
      guideId: parsed.data,
    });
    switch (result.kind) {
      case "open":
      case "closed":
        return { access: result.kind };
      case "unavailable":
        throw problemException(
          503,
          "dependency_unavailable",
          "Dependency unavailable",
        );
    }
  }
}
