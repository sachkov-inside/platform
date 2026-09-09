import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
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
import { anonymousSubject, type Subject } from "../../../content-access/index.js";
import {
  GUIDE_ARTIFACT_DELIVERY,
  type GuideArtifactDelivery,
} from "./deliver-guide-artifact.js";

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

@ApiTags("Guide artifacts")
@OptionalAccountEndpoint()
@Controller("guides")
export class GuideArtifactReadController {
  constructor(
    @Inject(GUIDE_ARTIFACT_DELIVERY)
    private readonly delivery: GuideArtifactDelivery,
  ) {}

  @Get(":guideId/artifacts")
  @ApiSecurity({})
  @ApiOperation({
    operationId: "readGuideArtifacts",
    summary: "Read the artifact section of one Guide through current access",
  })
  @ApiParam({ name: "guideId", schema: { format: "uuid", type: "string" } })
  @ApiOkResponse({ schema: toOpenApiSchema(publicArtifactListSchema) })
  @ApiNotFoundResponse({
    content: problemDetailsContent(artifactNotFoundProblemSchema),
    description: "Guide is absent",
  })
  @ApiServiceUnavailableResponse({
    content: problemDetailsContent(artifactDependencyProblemSchema),
    description: "Access or storage dependency is unavailable",
  })
  @ViewerAwareCatalogCache()
  async read(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("guideId") guideId: string,
  ) {
    if (!uuid.safeParse(guideId).success) throw artifactNotFound();
    const result = await this.delivery.read({
      guideId,
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

  @Get(":guideId/artifacts/:artifactId/file")
  @ApiSecurity({})
  @ApiOperation({
    operationId: "downloadGuideArtifact",
    summary: "Download one Guide Artifact file through current access",
  })
  @ApiParam({ name: "guideId", schema: { format: "uuid", type: "string" } })
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
    @Param("guideId") guideId: string,
    @Param("artifactId") artifactId: string,
    @Query("version") rawVersion: string | undefined,
    @Query("preview") preview: string | undefined,
  ) {
    const version = Number(rawVersion);
    if (
      !uuid.safeParse(guideId).success ||
      !uuid.safeParse(artifactId).success ||
      !Number.isInteger(version) ||
      version < 1 ||
      (preview !== undefined && preview !== "false" && preview !== "true")
    ) {
      throw artifactNotFound();
    }
    const result = await this.delivery.deliver({
      artifactId,
      guideId,
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

function artifactNotFound(): NotFoundException {
  return new NotFoundException({
    code: "artifact_not_found",
    status: 404,
    title: "Guide Artifact not found",
    type: "urn:inside:problem:artifact-not-found",
  });
}

function artifactDependencyUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: "dependency_unavailable",
    status: 503,
    title: "Guide Artifact dependency unavailable",
    type: "urn:inside:problem:dependency-unavailable",
  });
}
