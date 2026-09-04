import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { AssetDeliveryCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { MATERIAL_ASSET_LIMITS } from "../../../assets/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import { contentCoverProjectionHttpSchema } from "../../adapters/nest/content-cover-http.js";
import {
  CONTENT_COVERS,
  contentCoverOwnerKindSchema,
  type ChangeContentCoverResult,
  type ContentCovers,
} from "./content-covers.js";

const uuidSchema = z.uuid();
const checksumSchema = z.hash("sha256");
const changeResponseSchema = z
  .object({ cover: contentCoverProjectionHttpSchema.nullable() })
  .strict();
const removeBodySchema = z
  .object({ expectedCoverId: z.uuid().nullable() })
  .strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/content-covers")
export class AuthoringContentCoverController {
  constructor(
    @Inject(CONTENT_COVERS) private readonly covers: ContentCovers,
  ) {}

  @Put(":ownerKind/:ownerId")
  @ApiOperation({
    operationId: "uploadContentCover",
    summary: "Upload or replace one author-owned Material, Topic, or Series cover",
  })
  @ApiParam({
    name: "ownerKind",
    schema: toOpenApiSchema(contentCoverOwnerKindSchema),
  })
  @ApiParam({ name: "ownerId", schema: { format: "uuid", type: "string" } })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["declaredSize", "checksumSha256", "expectedCoverId", "file"],
      properties: {
        declaredSize: {
          type: "integer",
          minimum: 1,
          maximum: MATERIAL_ASSET_LIMITS.imageBytes,
        },
        checksumSha256: toOpenApiSchema(checksumSchema),
        expectedCoverId: {
          type: "string",
          description: "Current cover UUID or the literal null",
        },
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiOkResponse({ schema: toOpenApiSchema(changeResponseSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiResponse({ status: 400, content: problemDetailsContent(coverProblemSchema(400)) })
  @ApiResponse({ status: 403, content: problemDetailsContent(coverProblemSchema(403)) })
  @ApiResponse({ status: 404, content: problemDetailsContent(coverProblemSchema(404)) })
  @ApiResponse({ status: 409, content: problemDetailsContent(coverProblemSchema(409)) })
  @ApiResponse({ status: 413, content: problemDetailsContent(coverProblemSchema(413)) })
  @ApiResponse({ status: 422, content: problemDetailsContent(coverProblemSchema(422)) })
  @ApiResponse({ status: 503, content: problemDetailsContent(coverProblemSchema(503)) })
  async upload(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("ownerKind") rawOwnerKind: string,
    @Param("ownerId") ownerId: string,
    @Req() request: FastifyRequest,
  ) {
    const ownerKind = contentCoverOwnerKindSchema.safeParse(rawOwnerKind);
    if (!ownerKind.success || !uuidSchema.safeParse(ownerId).success) {
      throw coverProblem(400, "invalid_cover", "Cover owner is malformed");
    }
    let file: MultipartFile;
    try {
      const part = await request.file({
        limits: {
          fields: 3,
          fileSize: MATERIAL_ASSET_LIMITS.imageBytes,
          files: 1,
        },
      });
      if (part === undefined) throw new Error("missing file");
      file = part;
    } catch {
      throw coverProblem(422, "invalid_cover", "Cover form is malformed");
    }
    let body: Buffer;
    try {
      body = await file.toBuffer();
    } catch {
      throw coverProblem(413, "invalid_cover", "Cover exceeds the size limit");
    }
    if (file.file.truncated) {
      throw coverProblem(413, "invalid_cover", "Cover exceeds the size limit");
    }
    const declaredSize = Number(field(file, "declaredSize"));
    const checksum = checksumSchema.safeParse(field(file, "checksumSha256"));
    const expectedCoverId = parseExpectedCoverId(field(file, "expectedCoverId"));
    if (
      !Number.isInteger(declaredSize) ||
      declaredSize < 1 ||
      !checksum.success ||
      expectedCoverId === undefined
    ) {
      throw coverProblem(422, "invalid_cover", "Cover metadata is malformed");
    }
    const result = await this.covers.change({
      actor: account.accountId,
      body,
      declaredContentType: file.mimetype,
      declaredSize,
      expectedChecksumSha256: checksum.data,
      expectedCoverId,
      filename: file.filename,
      kind: "upload",
      owner: { id: ownerId, kind: ownerKind.data },
    });
    if (!result.ok) throwContentCoverError(result.error);
    return result.value;
  }

  @Delete(":ownerKind/:ownerId")
  @ApiOperation({
    operationId: "removeContentCover",
    summary: "Remove one current author-owned cover",
  })
  @ApiParam({
    name: "ownerKind",
    schema: toOpenApiSchema(contentCoverOwnerKindSchema),
  })
  @ApiParam({ name: "ownerId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(removeBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(changeResponseSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiResponse({ status: 400, content: problemDetailsContent(coverProblemSchema(400)) })
  @ApiResponse({ status: 403, content: problemDetailsContent(coverProblemSchema(403)) })
  @ApiResponse({ status: 404, content: problemDetailsContent(coverProblemSchema(404)) })
  @ApiResponse({ status: 409, content: problemDetailsContent(coverProblemSchema(409)) })
  @ApiResponse({ status: 503, content: problemDetailsContent(coverProblemSchema(503)) })
  async remove(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("ownerKind") rawOwnerKind: string,
    @Param("ownerId") ownerId: string,
    @Body() input: unknown,
  ) {
    const ownerKind = contentCoverOwnerKindSchema.safeParse(rawOwnerKind);
    const body = removeBodySchema.safeParse(input);
    if (
      !ownerKind.success ||
      !uuidSchema.safeParse(ownerId).success ||
      !body.success
    ) {
      throw coverProblem(400, "invalid_cover", "Cover removal is malformed");
    }
    const result = await this.covers.change({
      actor: account.accountId,
      expectedCoverId: body.data.expectedCoverId,
      kind: "remove",
      owner: { id: ownerId, kind: ownerKind.data },
    });
    if (!result.ok) throwContentCoverError(result.error);
    return result.value;
  }
}

@ApiTags("Content covers")
@Controller("content-covers")
export class ContentCoverDeliveryController {
  constructor(
    @Inject(CONTENT_COVERS) private readonly covers: ContentCovers,
  ) {}

  @Get(":coverId/:width")
  @AssetDeliveryCache()
  @ApiSecurity({})
  @ApiOperation({
    operationId: "readContentCover",
    summary: "Read one current public responsive cover rendition",
  })
  @ApiParam({ name: "coverId", schema: { format: "uuid", type: "string" } })
  @ApiParam({ name: "width", schema: { minimum: 1, type: "integer" } })
  @ApiProduces("image/webp")
  @ApiOkResponse({
    description: "Public immutable cover bytes",
    schema: { format: "binary", type: "string" },
  })
  @ApiResponse({ status: 404, content: problemDetailsContent(coverProblemSchema(404)) })
  @ApiResponse({ status: 503, content: problemDetailsContent(coverProblemSchema(503)) })
  async read(
    @Param("coverId") coverId: string,
    @Param("width") rawWidth: string,
  ) {
    const result = await this.covers.deliver({
      coverId,
      width: Number(rawWidth),
    });
    if (!result.ok) {
      if (result.error.code === "dependency_unavailable") {
        throw new ServiceUnavailableException({
          code: result.error.code,
          status: 503,
          title: "Content cover dependency unavailable",
          type: "urn:inside:problem:dependency-unavailable",
        });
      }
      throw new NotFoundException({
        code: "cover_not_found",
        status: 404,
        title: "Content cover not found",
        type: "urn:inside:problem:cover-not-found",
      });
    }
    return {
      ...result,
      cacheScope: "public-immutable" as const,
      kind: "bytes" as const,
    };
  }
}

function field(file: MultipartFile, name: string): string | undefined {
  const value = file.fields[name];
  return value === undefined || Array.isArray(value) || value.type !== "field"
    ? undefined
    : String(value.value);
}

function parseExpectedCoverId(value: string | undefined): string | null | undefined {
  if (value === "null") return null;
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function throwContentCoverError(
  error: Extract<ChangeContentCoverResult, { ok: false }>["error"],
): never {
  switch (error.code) {
    case "forbidden":
      throw coverProblem(403, error.code, "Content cover change is forbidden");
    case "owner_not_found":
      throw coverProblem(404, error.code, "Content cover owner was not found");
    case "conflict":
      throw new HttpException(
        {
          code: error.code,
          currentCoverId: error.currentCoverId,
          status: 409,
          title: "Content cover changed concurrently",
          type: "urn:inside:problem:content-cover-conflict",
        },
        409,
      );
    case "invalid_cover":
      throw coverProblem(422, error.code, "Cover image is not accepted");
    case "dependency_unavailable":
      throw coverProblem(503, error.code, "Content cover dependency is unavailable");
  }
}

function coverProblem(status: number, code: string, title: string): HttpException {
  return new HttpException(
    {
      code,
      status,
      title,
      type: `urn:inside:problem:${code.replaceAll("_", "-")}`,
    },
    status,
  );
}

function coverProblemSchema(status: number) {
  return z
    .object({
      code: z.string(),
      currentCoverId: z.uuid().nullable().optional(),
      status: z.literal(status),
      title: z.string(),
      type: z.string(),
    })
    .loose();
}
