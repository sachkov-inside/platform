import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from "@nestjs/swagger";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

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
import {
  GUIDE_ARTIFACTS,
  guideArtifactAccessSchema,
  type GuideArtifactError,
  type GuideArtifacts,
  type UploadedArtifactFile,
} from "./guide-artifacts.js";

const uuidSchema = z.uuid();
const checksumSchema = z.hash("sha256");
const externalUrlSchema = z.url({ protocol: /^https?$/u }).max(2048);
const metadataBodySchema = z
  .object({
    access: guideArtifactAccessSchema,
    purpose: z.string().max(1000),
    title: z.string().min(1).max(200),
  })
  .strict();
const createLinkBodySchema = metadataBodySchema
  .extend({ externalUrl: externalUrlSchema, guideId: uuidSchema })
  .strict();
const replaceLinkBodySchema = z
  .object({ externalUrl: externalUrlSchema })
  .strict();
const archiveBodySchema = z.object({ archived: z.boolean() }).strict();
const guidesBodySchema = z
  .object({ guideIds: z.array(uuidSchema).max(50) })
  .strict();
const materialsBodySchema = z
  .object({ materialIds: z.array(uuidSchema).max(200) })
  .strict();

const artifactContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      contentType: z.string(),
      filename: z.string(),
      kind: z.literal("file"),
      size: z.number().int().positive(),
    })
    .strict(),
  z.object({ externalUrl: z.string(), kind: z.literal("link") }).strict(),
]);
export const guideArtifactHttpSchema = z
  .object({
    access: guideArtifactAccessSchema,
    archived: z.boolean(),
    artifactId: z.uuid(),
    content: artifactContentSchema,
    guideIds: z.array(z.uuid()),
    materialIds: z.array(z.uuid()),
    origin: z.enum(["authoring", "platform"]),
    purpose: z.string(),
    sourceId: z.string().nullable(),
    title: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();
const guideArtifactListSchema = z
  .object({ artifacts: z.array(guideArtifactHttpSchema) })
  .strict();
const removedArtifactSchema = z.object({ artifactId: z.uuid() }).strict();
const multipartUploadFields = {
  checksumSha256: toOpenApiSchema(checksumSchema),
  declaredSize: {
    maximum: MATERIAL_ASSET_LIMITS.fileBytes,
    minimum: 1,
    type: "integer",
  },
  file: { format: "binary", type: "string" },
} as const;

export const guideArtifactProblemSchema = z
  .object({
    code: z.enum([
      "artifact_not_found",
      "artifact_referenced",
      "dependency_unavailable",
      "forbidden",
      "guide_not_found",
      "invalid_artifact",
      "invalid_content",
      "material_not_found",
      "source_conflict",
    ]),
    guideIds: z.array(z.uuid()).optional(),
    status: z.number().int(),
    title: z.string(),
    type: z.string(),
  })
  .strict();

function ApiGuideArtifactErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        content: problemDetailsContent(guideArtifactProblemSchema),
        status,
      }),
    ),
  );
}

@MaterialAuthoringEndpoint()
@Controller()
export class GuideArtifactAuthoringController {
  constructor(
    @Inject(GUIDE_ARTIFACTS) private readonly artifacts: GuideArtifacts,
  ) {}

  @Get("authoring/guides/:guideId/artifacts")
  @ApiOperation({
    operationId: "listAuthoringGuideArtifacts",
    summary: "List the artifacts placed in one Guide",
  })
  @ApiParam({ name: "guideId", schema: { format: "uuid", type: "string" } })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactListSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(400, 403, 404, 503)
  async list(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("guideId") guideId: string,
  ) {
    const result = await this.artifacts.listForGuide({
      actor: account.accountId,
      guideId,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return { artifacts: result.value };
  }

  @Get("authoring/guide-artifacts")
  @ApiOperation({
    operationId: "listReusableGuideArtifacts",
    summary: "List every active artifact an author may reuse in another Guide",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactListSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 503)
  async listReusable(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.artifacts.listReusable({
      actor: account.accountId,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return { artifacts: result.value };
  }

  @Post("authoring/guide-artifacts/files")
  @ApiOperation({
    operationId: "createGuideArtifactFromFile",
    summary: "Create one Guide Artifact from an uploaded file",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      properties: {
        ...multipartUploadFields,
        access: toOpenApiSchema(guideArtifactAccessSchema),
        guideId: { format: "uuid", type: "string" },
        purpose: { maxLength: 1000, type: "string" },
        title: { maxLength: 200, minLength: 1, type: "string" },
      },
      required: [
        "guideId",
        "title",
        "purpose",
        "access",
        "declaredSize",
        "checksumSha256",
        "file",
      ],
      type: "object",
    },
  })
  @ApiCreatedResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(400, 403, 404, 409, 413, 422, 503)
  async createFromFile(
    @CurrentAccount() account: AuthenticatedAccount,
    @Req() request: FastifyRequest,
  ) {
    const upload = await readUpload(request, 5);
    const metadata = metadataBodySchema.safeParse({
      access: field(upload.part, "access"),
      purpose: field(upload.part, "purpose") ?? "",
      title: field(upload.part, "title") ?? "",
    });
    const guideId = uuidSchema.safeParse(field(upload.part, "guideId"));
    if (!metadata.success || !guideId.success) {
      throw guideArtifactProblem(422, "invalid_artifact", "Guide Artifact form is malformed");
    }
    const result = await this.artifacts.create({
      actor: account.accountId,
      file: upload.file,
      guideId: guideId.data,
      kind: "file",
      metadata: metadata.data,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Post("authoring/guide-artifacts/links")
  @ApiOperation({
    operationId: "createGuideArtifactFromLink",
    summary: "Create one Guide Artifact that points at an explicit external address",
  })
  @ApiBody({ schema: toOpenApiSchema(createLinkBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 422, 503)
  async createFromLink(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseBody(createLinkBodySchema, input);
    const result = await this.artifacts.create({
      actor: account.accountId,
      externalUrl: body.externalUrl,
      guideId: body.guideId,
      kind: "link",
      metadata: {
        access: body.access,
        purpose: body.purpose,
        title: body.title,
      },
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Patch("authoring/guide-artifacts/:artifactId")
  @ApiOperation({
    operationId: "updateGuideArtifact",
    summary: "Change the name, purpose or access class of one Guide Artifact",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(metadataBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 422, 503)
  async update(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
    @Body() input: unknown,
  ) {
    const body = parseBody(metadataBodySchema, input);
    const result = await this.artifacts.update({
      actor: account.accountId,
      artifactId,
      metadata: body,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/guide-artifacts/file")
  @ApiOperation({
    operationId: "replaceGuideArtifactFile",
    summary: "Replace the artifact content with a new uploaded file version",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      properties: {
        ...multipartUploadFields,
        artifactId: { format: "uuid", type: "string" },
      },
      required: ["artifactId", "declaredSize", "checksumSha256", "file"],
      type: "object",
    },
  })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 413, 422, 503)
  async replaceFile(
    @CurrentAccount() account: AuthenticatedAccount,
    @Req() request: FastifyRequest,
  ) {
    const upload = await readUpload(request, 3);
    const artifactId = uuidSchema.safeParse(field(upload.part, "artifactId"));
    if (!artifactId.success) {
      throw guideArtifactProblem(422, "invalid_artifact", "Guide Artifact form is malformed");
    }
    const result = await this.artifacts.replaceContent({
      actor: account.accountId,
      artifactId: artifactId.data,
      file: upload.file,
      kind: "file",
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/guide-artifacts/:artifactId/link")
  @ApiOperation({
    operationId: "replaceGuideArtifactLink",
    summary: "Replace the artifact content with a new external address version",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(replaceLinkBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 422, 503)
  async replaceLink(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
    @Body() input: unknown,
  ) {
    const body = parseBody(replaceLinkBodySchema, input);
    const result = await this.artifacts.replaceContent({
      actor: account.accountId,
      artifactId,
      externalUrl: body.externalUrl,
      kind: "link",
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/guide-artifacts/:artifactId/archive")
  @ApiOperation({
    operationId: "setGuideArtifactArchived",
    summary: "Archive one Guide Artifact or return it from the archive",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(archiveBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 422, 503)
  async setArchived(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
    @Body() input: unknown,
  ) {
    const body = parseBody(archiveBodySchema, input);
    const result = await this.artifacts.setArchived({
      actor: account.accountId,
      archived: body.archived,
      artifactId,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/guide-artifacts/:artifactId/guides")
  @ApiOperation({
    operationId: "setGuideArtifactGuides",
    summary: "Set the Guides that reuse one artifact without copying it",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(guidesBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 422, 503)
  async setGuides(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
    @Body() input: unknown,
  ) {
    const body = parseBody(guidesBodySchema, input);
    const result = await this.artifacts.setGuides({
      actor: account.accountId,
      artifactId,
      guideIds: body.guideIds,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/guide-artifacts/:artifactId/materials")
  @ApiOperation({
    operationId: "setGuideArtifactMaterials",
    summary: "Set the Materials one artifact belongs with inside its Guides",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(materialsBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(guideArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 422, 503)
  async setMaterials(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
    @Body() input: unknown,
  ) {
    const body = parseBody(materialsBodySchema, input);
    const result = await this.artifacts.setMaterials({
      actor: account.accountId,
      artifactId,
      materialIds: body.materialIds,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }

  @Delete("authoring/guide-artifacts/:artifactId")
  @ApiOperation({
    operationId: "removeGuideArtifact",
    summary: "Remove one Guide Artifact that no Guide or Material still references",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiOkResponse({ schema: toOpenApiSchema(removedArtifactSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiGuideArtifactErrors(403, 404, 409, 503)
  async remove(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
  ) {
    const result = await this.artifacts.remove({
      actor: account.accountId,
      artifactId,
    });
    if (!result.ok) throwGuideArtifactError(result.error);
    return result.value;
  }
}

async function readUpload(
  request: FastifyRequest,
  fields: number,
): Promise<{ readonly file: UploadedArtifactFile; readonly part: MultipartFile }> {
  let part: MultipartFile;
  try {
    const uploaded = await request.file({
      limits: { fields, fileSize: MATERIAL_ASSET_LIMITS.fileBytes, files: 1 },
    });
    if (uploaded === undefined) throw new Error("missing file");
    part = uploaded;
  } catch {
    throw guideArtifactProblem(422, "invalid_artifact", "Guide Artifact form is malformed");
  }
  let body: Buffer;
  try {
    body = await part.toBuffer();
  } catch {
    throw guideArtifactProblem(413, "invalid_content", "Guide Artifact exceeds the size limit");
  }
  if (part.file.truncated) {
    throw guideArtifactProblem(413, "invalid_content", "Guide Artifact exceeds the size limit");
  }
  const declaredSize = Number(field(part, "declaredSize"));
  const checksum = checksumSchema.safeParse(field(part, "checksumSha256"));
  if (!Number.isInteger(declaredSize) || declaredSize < 1 || !checksum.success) {
    throw guideArtifactProblem(422, "invalid_artifact", "Guide Artifact form is malformed");
  }
  return {
    file: {
      body,
      declaredContentType: part.mimetype,
      declaredSize,
      expectedChecksumSha256: checksum.data,
      filename: part.filename,
    },
    part,
  };
}

function field(file: MultipartFile, name: string): string | undefined {
  const value = file.fields[name];
  return value === undefined || Array.isArray(value) || value.type !== "field"
    ? undefined
    : String(value.value);
}

function parseBody<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw guideArtifactProblem(422, "invalid_artifact", "Guide Artifact request is malformed");
  }
  return parsed.data;
}

function throwGuideArtifactError(error: GuideArtifactError): never {
  switch (error.code) {
    case "forbidden":
      throw guideArtifactProblem(403, error.code, "Guide Artifact change is forbidden");
    case "artifact_not_found":
      throw guideArtifactProblem(404, error.code, "Guide Artifact was not found");
    case "guide_not_found":
      throw guideArtifactProblem(404, error.code, "Guide was not found");
    case "material_not_found":
      throw guideArtifactProblem(404, error.code, "Material was not found");
    case "artifact_referenced":
      throw new HttpException(
        {
          code: error.code,
          guideIds: error.guideIds,
          status: 409,
          title: "Guide Artifact is still referenced",
          type: "urn:inside:problem:artifact-referenced",
        },
        409,
      );
    case "source_conflict":
      throw guideArtifactProblem(409, error.code, "Authoring source identifiers repeat");
    case "invalid_content":
      throw guideArtifactProblem(422, error.code, "Guide Artifact content is not accepted");
    case "invalid_artifact":
      throw guideArtifactProblem(422, error.code, "Guide Artifact request is malformed");
    case "dependency_unavailable":
      throw guideArtifactProblem(503, error.code, "Guide Artifact dependency is unavailable");
  }
}

function guideArtifactProblem(
  status: number,
  code: string,
  title: string,
): HttpException {
  return new HttpException(
    { code, status, title, type: guideArtifactProblemType(code) },
    status,
  );
}

function guideArtifactProblemType(code: string): string {
  return `urn:inside:problem:${code.replaceAll("_", "-")}`;
}
