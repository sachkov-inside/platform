import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Put,
  Req,
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
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { MATERIAL_ASSET_LIMITS } from "../../../assets/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import { contentCoverProjectionHttpSchema } from "../../adapters/nest/content-cover-http.js";
import { authoringSourceIdSchema } from "../../domain/authoring-source.js";
import {
  CONTENT_COVERS,
  contentCoverOwnerKindSchema,
  type ChangeContentCoverCommand,
  type ChangeContentCoverResult,
  type ContentCovers,
} from "./content-covers.js";
import {
  problemException,
  problemType,
} from "../../../../infrastructure/http/problem-details.js";

const uuidSchema = z.uuid();
const checksumSchema = z.hash("sha256");
const multipartExpectedCoverIdSchema = z.union([z.uuid(), z.literal("null")]);
// declaredSize, checksumSha256 and expectedCoverId; the import route adds sourceId.
const uploadFieldLimit = 3;
const changeResponseSchema = z
  .object({ cover: contentCoverProjectionHttpSchema.nullable() })
  .strict();
const removeBodySchema = z
  .object({ expectedCoverId: z.uuid().nullable() })
  .strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/content-covers")
export class AuthoringContentCoverController {
  constructor(@Inject(CONTENT_COVERS) private readonly covers: ContentCovers) {}

  @Put(":ownerKind/:ownerId")
  @ApiOperation({
    operationId: "uploadContentCover",
    summary:
      "Upload or replace one author-owned Material, Topic, or Series cover",
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
        expectedCoverId: toOpenApiSchema(multipartExpectedCoverIdSchema),
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiOkResponse({ schema: toOpenApiSchema(changeResponseSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      coverProblemSchema(400, "invalid_cover", ["Cover owner is malformed"]),
    ),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      coverProblemSchema(403, "forbidden", [
        "Content cover change is forbidden",
      ]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      coverProblemSchema(404, "owner_not_found", [
        "Content cover owner was not found",
      ]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(coverConflictProblemSchema()),
  })
  @ApiResponse({
    status: 413,
    content: problemDetailsContent(
      coverProblemSchema(413, "invalid_cover", [
        "Cover exceeds the size limit",
      ]),
    ),
  })
  @ApiResponse({
    status: 422,
    content: problemDetailsContent(
      coverProblemSchema(422, "invalid_cover", [
        "Cover form is malformed",
        "Cover metadata is malformed",
        "Cover image is not accepted",
      ]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      coverProblemSchema(503, "dependency_unavailable", [
        "Content cover dependency is unavailable",
      ]),
    ),
  })
  async upload(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("ownerKind") rawOwnerKind: string,
    @Param("ownerId") ownerId: string,
    @Req() request: FastifyRequest,
  ) {
    const upload = await readCoverUpload(
      request,
      rawOwnerKind,
      ownerId,
      uploadFieldLimit,
    );
    const result = await this.covers.change({
      actor: account.accountId,
      ...upload.command,
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
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      coverProblemSchema(400, "invalid_cover", ["Cover removal is malformed"]),
    ),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      coverProblemSchema(403, "forbidden", [
        "Content cover change is forbidden",
      ]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      coverProblemSchema(404, "owner_not_found", [
        "Content cover owner was not found",
      ]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(coverConflictProblemSchema()),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      coverProblemSchema(503, "dependency_unavailable", [
        "Content cover dependency is unavailable",
      ]),
    ),
  })
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
      throw problemException(
        400,
        "invalid_cover",
        "Cover removal is malformed",
      );
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

async function readCoverUpload(
  request: FastifyRequest,
  rawOwnerKind: string,
  ownerId: string,
  fieldLimit: number,
): Promise<{
  readonly command: Omit<
    Extract<ChangeContentCoverCommand, { kind: "upload" }>,
    "actor"
  >;
  readonly part: MultipartFile;
}> {
  const ownerKind = contentCoverOwnerKindSchema.safeParse(rawOwnerKind);
  if (!ownerKind.success || !uuidSchema.safeParse(ownerId).success) {
    throw problemException(400, "invalid_cover", "Cover owner is malformed");
  }
  let file: MultipartFile;
  try {
    const part = await request.file({
      limits: {
        fields: fieldLimit,
        fileSize: MATERIAL_ASSET_LIMITS.imageBytes,
        files: 1,
      },
    });
    if (part === undefined) throw new Error("missing file");
    file = part;
  } catch {
    // Not a dependency failure: the client sent a malformed form.
    throw problemException(422, "invalid_cover", "Cover form is malformed");
  }
  let body: Buffer;
  try {
    body = await file.toBuffer();
  } catch {
    // Not a dependency failure: the upload exceeds its size limit.
    throw problemException(
      413,
      "invalid_cover",
      "Cover exceeds the size limit",
    );
  }
  if (file.file.truncated) {
    throw problemException(
      413,
      "invalid_cover",
      "Cover exceeds the size limit",
    );
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
    throw problemException(422, "invalid_cover", "Cover metadata is malformed");
  }
  return {
    command: {
      body,
      declaredContentType: file.mimetype,
      declaredSize,
      expectedChecksumSha256: checksum.data,
      expectedCoverId,
      filename: file.filename,
      kind: "upload",
      owner: { id: ownerId, kind: ownerKind.data },
    },
    part: file,
  };
}

/** Source-scoped cover changes for Materials owned by an authoring import. */
@MaterialAuthoringEndpoint()
@Controller("authoring/import/content-covers")
export class ImportContentCoverController {
  constructor(@Inject(CONTENT_COVERS) private readonly covers: ContentCovers) {}

  @Put("material/:ownerId")
  @ApiOperation({
    operationId: "uploadImportedMaterialCover",
    summary:
      "Upload or replace the cover of one Material owned by an authoring source",
  })
  @ApiParam({ name: "ownerId", schema: { format: "uuid", type: "string" } })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: [
        "sourceId",
        "declaredSize",
        "checksumSha256",
        "expectedCoverId",
        "file",
      ],
      properties: {
        sourceId: { type: "string", minLength: 1, maxLength: 200 },
        declaredSize: {
          type: "integer",
          minimum: 1,
          maximum: MATERIAL_ASSET_LIMITS.imageBytes,
        },
        checksumSha256: toOpenApiSchema(checksumSchema),
        expectedCoverId: toOpenApiSchema(multipartExpectedCoverIdSchema),
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiOkResponse({ schema: toOpenApiSchema(changeResponseSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      coverProblemSchema(400, "invalid_cover", ["Cover owner is malformed"]),
    ),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      coverProblemSchema(403, "forbidden", [
        "Content cover change is forbidden",
      ]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      coverProblemSchema(404, "owner_not_found", [
        "Content cover owner was not found",
      ]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(coverConflictProblemSchema()),
  })
  @ApiResponse({
    status: 413,
    content: problemDetailsContent(
      coverProblemSchema(413, "invalid_cover", [
        "Cover exceeds the size limit",
      ]),
    ),
  })
  @ApiResponse({
    status: 422,
    content: problemDetailsContent(
      coverProblemSchema(422, "invalid_cover", [
        "Cover form is malformed",
        "Cover metadata is malformed",
        "Cover image is not accepted",
      ]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      coverProblemSchema(503, "dependency_unavailable", [
        "Content cover dependency is unavailable",
      ]),
    ),
  })
  async upload(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("ownerId") ownerId: string,
    @Req() request: FastifyRequest,
  ) {
    const upload = await readCoverUpload(
      request,
      "material",
      ownerId,
      uploadFieldLimit + 1,
    );
    const sourceId = authoringSourceIdSchema.safeParse(
      field(upload.part, "sourceId"),
    );
    if (!sourceId.success)
      throw problemException(
        422,
        "invalid_cover",
        "Cover metadata is malformed",
      );
    const result = await this.covers.changeImported(
      { actor: account.accountId, ...upload.command },
      sourceId.data,
    );
    if (!result.ok) throwContentCoverError(result.error);
    return result.value;
  }
}

@ApiTags("Content covers")
@Controller("content-covers")
export class ContentCoverDeliveryController {
  constructor(@Inject(CONTENT_COVERS) private readonly covers: ContentCovers) {}

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
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      coverProblemSchema(404, "cover_not_found", ["Content cover not found"]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      coverProblemSchema(503, "dependency_unavailable", [
        "Content cover dependency unavailable",
      ]),
    ),
  })
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
        throw problemException(
          503,
          result.error.code,
          "Content cover dependency unavailable",
        );
      }
      throw problemException(404, "cover_not_found", "Content cover not found");
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

function parseExpectedCoverId(
  value: string | undefined,
): string | null | undefined {
  if (value === "null") return null;
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function throwContentCoverError(
  error: Extract<ChangeContentCoverResult, { ok: false }>["error"],
): never {
  switch (error.code) {
    case "forbidden":
      throw problemException(
        403,
        error.code,
        "Content cover change is forbidden",
      );
    case "owner_not_found":
      throw problemException(
        404,
        error.code,
        "Content cover owner was not found",
      );
    case "conflict":
      throw problemException(
        409,
        error.code,
        "Content cover changed concurrently",
        {
          currentCoverId: error.currentCoverId,
        },
      );
    case "invalid_cover":
      throw problemException(422, error.code, "Cover image is not accepted");
    case "dependency_unavailable":
      throw problemException(
        503,
        error.code,
        "Content cover dependency is unavailable",
      );
  }
}

function coverConflictProblemSchema() {
  return z
    .object({
      code: z.literal("conflict"),
      currentCoverId: z.uuid().nullable(),
      status: z.literal(409),
      title: z.literal("Content cover changed concurrently"),
      type: z.literal(problemType("conflict")),
    })
    .strict();
}

function coverProblemSchema<
  const Status extends number,
  const Code extends string,
>(status: Status, code: Code, titles: readonly [string, ...string[]]) {
  return z
    .object({
      code: z.literal(code),
      status: z.literal(status),
      title: z.enum(titles),
      type: z.literal(problemType(code)),
    })
    .strict();
}
