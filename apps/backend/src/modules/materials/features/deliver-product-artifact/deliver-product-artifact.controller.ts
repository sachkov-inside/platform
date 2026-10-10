import {
  Controller,
  Get,
  Inject,
  type HttpException,
  Param,
  Query,
} from "@nestjs/common";
import {
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import {
  AssetDeliveryCache,
  ViewerAwareCatalogCache,
} from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountId as checkedAccountId,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  anonymousSubject,
  type Subject,
} from "../../../content-access/index.js";
import {
  PRODUCT_ARTIFACT_DELIVERY,
  type ProductArtifactDelivery,
} from "./deliver-product-artifact.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";

const uuid = z.uuid();
const publicContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      contentType: z.string(),
      filename: z.string(),
      kind: z.literal("file"),
      size: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ externalUrl: z.string().nullable(), kind: z.literal("link") })
    .strict(),
]);
const publicArtifactSchema = z
  .object({
    artifactId: z.uuid(),
    availability: z.enum(["available", "locked"]),
    content: publicContentSchema,
    purpose: z.string(),
    title: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();
const publicArtifactListSchema = z
  .object({ artifacts: z.array(publicArtifactSchema) })
  .strict();
const artifactNotFoundProblemSchema = z
  .object({
    code: z.literal("artifact_not_found"),
    status: z.literal(404),
    title: z.string(),
    type: z.string(),
  })
  .strict();
const artifactDependencyProblemSchema = z
  .object({
    code: z.literal("dependency_unavailable"),
    status: z.literal(503),
    title: z.string(),
    type: z.string(),
  })
  .strict();

@ApiTags("Product artifacts")
@OptionalAccountEndpoint()
@Controller("products")
export class ProductArtifactReadController {
  constructor(
    @Inject(PRODUCT_ARTIFACT_DELIVERY)
    private readonly delivery: ProductArtifactDelivery,
  ) {}

  @Get(":productId/artifacts")
  @ApiSecurity({})
  @ApiOperation({
    operationId: "readProductArtifacts",
    summary: "Read the artifact section of one Product through current access",
  })
  @ApiParam({ name: "productId", schema: { format: "uuid", type: "string" } })
  @ApiOkResponse({ schema: toOpenApiSchema(publicArtifactListSchema) })
  @ApiNotFoundResponse({
    content: problemDetailsContent(artifactNotFoundProblemSchema),
    description: "Product is absent",
  })
  @ApiServiceUnavailableResponse({
    content: problemDetailsContent(artifactDependencyProblemSchema),
    description: "Access or storage dependency is unavailable",
  })
  @ViewerAwareCatalogCache()
  async read(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("productId") productId: string,
  ) {
    if (!uuid.safeParse(productId).success) throw artifactNotFound();
    const result = await this.delivery.read({
      productId,
      subject: subjectOf(account),
    });
    if (!result.ok) {
      if (result.error.code === "dependency_unavailable") {
        throw artifactDependencyUnavailable();
      }
      throw artifactNotFound();
    }
    return { artifacts: result.value };
  }

  @Get(":productId/artifacts/:artifactId/file")
  @ApiSecurity({})
  @ApiOperation({
    operationId: "downloadProductArtifact",
    summary: "Download one Product Artifact file through current access",
  })
  @ApiParam({ name: "productId", schema: { format: "uuid", type: "string" } })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiQuery({
    name: "version",
    required: true,
    schema: { minimum: 1, type: "integer" },
  })
  @ApiQuery({ name: "preview", required: false, schema: { type: "boolean" } })
  @ApiProduces("application/octet-stream")
  @ApiOkResponse({
    description: "Public immutable file bytes",
    schema: { format: "binary", type: "string" },
  })
  @ApiFoundResponse({
    description: "Short-lived protected redirect",
    headers: { Location: { schema: { format: "uri", type: "string" } } },
  })
  @ApiNotFoundResponse({
    content: problemDetailsContent(artifactNotFoundProblemSchema),
    description: "Artifact is absent or not currently accessible",
  })
  @ApiServiceUnavailableResponse({
    content: problemDetailsContent(artifactDependencyProblemSchema),
    description: "Access or storage dependency is unavailable",
  })
  @AssetDeliveryCache()
  async download(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("productId") productId: string,
    @Param("artifactId") artifactId: string,
    @Query("version") rawVersion: string | undefined,
    @Query("preview") preview: string | undefined,
  ) {
    const version = Number(rawVersion);
    if (
      !uuid.safeParse(productId).success ||
      !uuid.safeParse(artifactId).success ||
      !Number.isInteger(version) ||
      version < 1 ||
      (preview !== undefined && preview !== "false" && preview !== "true")
    ) {
      throw artifactNotFound();
    }
    const result = await this.delivery.deliver({
      artifactId,
      productId,
      preview: preview === "true",
      subject: subjectOf(account),
      version,
    });
    if (!result.ok) {
      if (result.error.code === "dependency_unavailable") {
        throw artifactDependencyUnavailable();
      }
      throw artifactNotFound();
    }
    return result.value;
  }
}

function subjectOf(account: AuthenticatedAccount | undefined): Subject {
  return account === undefined
    ? anonymousSubject
    : { accountId: checkedAccountId(account.accountId), kind: "account" };
}

function artifactNotFound(): HttpException {
  return problemException(
    404,
    "artifact_not_found",
    "Product Artifact not found",
  );
}

function artifactDependencyUnavailable(): HttpException {
  return problemException(
    503,
    "dependency_unavailable",
    "Product Artifact dependency unavailable",
  );
}
