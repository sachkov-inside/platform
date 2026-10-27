import { ProductDirectory } from "../../../products/index.js";
import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountId,
  accountProblemSchema,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  CONTENT_ACCESS,
  anonymousSubject,
  type ContentAccess,
} from "../../../content-access/index.js";
import { PublishedMaterialSelection } from "../../../materials/index.js";
import {
  readerReferenceIdSchema,
  readerReferenceSchema,
  readReaderReference,
} from "./read-reader-reference.js";

@ApiTags("Content library")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("library")
export class ReadReaderReferenceController {
  constructor(
    @Inject(ProductDirectory) private readonly directory: ProductDirectory,
    @Inject(PublishedMaterialSelection)
    private readonly selection: PublishedMaterialSelection,
    @Inject(CONTENT_ACCESS)
    private readonly contentAccess: Pick<
      ContentAccess,
      "checkAvailabilityMany" | "checkProductAccessMany"
    >,
  ) {}

  @Get("products/by-id/:id/reference")
  @ApiOperation({
    operationId: "readReaderProductReference",
    summary: "Read one reader-visible Product identity",
  })
  @ReferenceResponses()
  product(
    @Param("id") id: string,
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
  ) {
    return this.read("product", id, account);
  }

  @Get("materials/by-id/:id/reference")
  @ApiOperation({
    operationId: "readReaderMaterialReference",
    summary:
      "Read one published Material identity with current reader availability",
  })
  @ReferenceResponses()
  material(
    @Param("id") id: string,
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
  ) {
    return this.read("material", id, account);
  }

  private async read(
    kind: "product" | "material",
    id: string,
    account: AuthenticatedAccount | undefined,
  ) {
    const result = await readReaderReference(
      {
        directory: this.directory,
        selection: this.selection,
        contentAccess: this.contentAccess,
      },
      account === undefined
        ? anonymousSubject
        : { kind: "account", accountId: accountId(account.accountId) },
      kind,
      id,
    );
    if (!result.ok)
      throw problemException(
        result.code === "invalid_request"
          ? 400
          : result.code === "not_found"
            ? 404
            : 503,
        result.code,
        "Reader reference unavailable",
      );
    return result.value;
  }
}

function ReferenceResponses(): MethodDecorator {
  return (target, key, descriptor) => {
    ApiParam({ name: "id", schema: toOpenApiSchema(readerReferenceIdSchema) })(
      target,
      key,
      descriptor,
    );
    ApiOkResponse({ schema: toOpenApiSchema(readerReferenceSchema) })(
      target,
      key,
      descriptor,
    );
    for (const [status, code] of [
      [400, "invalid_request"],
      [404, "not_found"],
    ] as const)
      ApiResponse({
        status,
        content: problemDetailsContent(problemDetailsSchema(status, [code])),
      })(target, key, descriptor);
    ApiResponse({
      status: 503,
      content: problemDetailsOneOfContent(
        problemDetailsSchema(503, ["dependency_unavailable"]),
        accountProblemSchema,
      ),
    })(target, key, descriptor);
  };
}
