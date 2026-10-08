import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
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
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { MATERIAL_ASSET_LIMITS } from "../../../assets/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import { authoringSourceIdSchema } from "../../domain/authoring-source.js";
import {
  PRODUCT_ARTIFACTS,
  productArtifactAccessSchema,
  type ProductArtifactError,
  type ProductArtifacts,
  type UploadedArtifactFile,
} from "./product-artifacts.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { metadataSchema } from "./product-artifact-commands.js";

const uuidSchema = z.uuid();
const checksumSchema = z.hash("sha256");
const externalUrlSchema = z.url({ protocol: /^https?$/u }).max(2048);
const createLinkBodySchema = metadataSchema
  .extend({ externalUrl: externalUrlSchema, productId: uuidSchema })
  .strict();
const replaceLinkBodySchema = z
  .object({ externalUrl: externalUrlSchema })
  .strict();
const archiveBodySchema = z.object({ archived: z.boolean() }).strict();
const productsBodySchema = z
  .object({ productIds: z.array(uuidSchema).max(50) })
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
export const productArtifactHttpSchema = z
  .object({
    access: productArtifactAccessSchema,
    archived: z.boolean(),
    artifactId: z.uuid(),
    content: artifactContentSchema,
    productIds: z.array(z.uuid()),
    materialIds: z.array(z.uuid()),
    origin: z.enum(["authoring", "platform"]),
    purpose: z.string(),
    sourceId: z.string().nullable(),
    title: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();
const productArtifactListSchema = z
  .object({ artifacts: z.array(productArtifactHttpSchema) })
  .strict();
const removedArtifactSchema = z.object({ artifactId: z.uuid() }).strict();
// productSourceId, sourceId, title, purpose, access, declaredSize and checksumSha256.
const sourceImportFieldLimit = 7;
const importOutcomeSchema = z
  .object({
    artifactId: z.uuid(),
    outcome: z.enum(["created", "diverged", "missing", "unchanged", "updated"]),
    sourceId: z.string().nullable(),
    title: z.string(),
  })
  .strict();
const multipartUploadFields = {
  checksumSha256: toOpenApiSchema(checksumSchema),
  declaredSize: {
    maximum: MATERIAL_ASSET_LIMITS.fileBytes,
    minimum: 1,
    type: "integer",
  },
  file: { format: "binary", type: "string" },
} as const;

export const productArtifactProblemSchema = z
  .object({
    code: z.enum([
      "artifact_not_found",
      "artifact_referenced",
      "dependency_unavailable",
      "forbidden",
      "product_not_found",
      "invalid_artifact",
      "invalid_content",
      "material_not_found",
      "source_conflict",
    ]),
    productIds: z.array(z.uuid()).optional(),
    status: z.number().int(),
    title: z.string(),
    type: z.string(),
  })
  .strict();

function ApiProductArtifactErrors(...statuses: readonly number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        content: problemDetailsContent(productArtifactProblemSchema),
        status,
      }),
    ),
  );
}

@MaterialAuthoringEndpoint()
@Controller()
export class ProductArtifactAuthoringController {
  constructor(
    @Inject(PRODUCT_ARTIFACTS) private readonly artifacts: ProductArtifacts,
  ) {}

  @Get("authoring/products/:productId/artifacts")
  @ApiOperation({
    operationId: "listAuthoringProductArtifacts",
    summary: "List the artifacts placed in one Product",
  })
  @ApiParam({ name: "productId", schema: { format: "uuid", type: "string" } })
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactListSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(400, 403, 404, 503)
  async list(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("productId") productId: string,
  ) {
    const result = await this.artifacts.listForProduct({
      actor: account.accountId,
      productId,
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return { artifacts: result.value };
  }

  @Get("authoring/product-artifacts")
  @ApiOperation({
    operationId: "listReusableProductArtifacts",
    summary:
      "List every active artifact an author may reuse in another Product",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactListSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 503)
  async listReusable(@CurrentAccount() account: AuthenticatedAccount) {
    const result = await this.artifacts.listReusable({
      actor: account.accountId,
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return { artifacts: result.value };
  }

  @Post("authoring/product-artifacts/files")
  @ApiOperation({
    operationId: "createProductArtifactFromFile",
    summary: "Create one Product Artifact from an uploaded file",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      properties: {
        ...multipartUploadFields,
        access: toOpenApiSchema(productArtifactAccessSchema),
        productId: { format: "uuid", type: "string" },
        purpose: { maxLength: 1000, type: "string" },
        title: { maxLength: 200, minLength: 1, type: "string" },
      },
      required: [
        "productId",
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
  @ApiCreatedResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(400, 403, 404, 409, 413, 422, 503)
  async createFromFile(
    @CurrentAccount() account: AuthenticatedAccount,
    @Req() request: FastifyRequest,
  ) {
    const upload = await readUpload(request, 6);
    const metadata = metadataSchema.safeParse({
      access: field(upload.part, "access"),
      purpose: field(upload.part, "purpose") ?? "",
      title: field(upload.part, "title") ?? "",
    });
    const productId = uuidSchema.safeParse(field(upload.part, "productId"));
    if (!metadata.success || !productId.success) {
      throw problemException(
        422,
        "invalid_artifact",
        "Product Artifact form is malformed",
      );
    }
    const result = await this.artifacts.create({
      actor: account.accountId,
      file: upload.file,
      productId: productId.data,
      kind: "file",
      metadata: metadata.data,
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Post("authoring/product-artifacts/links")
  @ApiOperation({
    operationId: "createProductArtifactFromLink",
    summary:
      "Create one Product Artifact that points at an explicit external address",
  })
  @ApiBody({ schema: toOpenApiSchema(createLinkBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 422, 503)
  async createFromLink(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseBody(createLinkBodySchema, input);
    const result = await this.artifacts.create({
      actor: account.accountId,
      externalUrl: body.externalUrl,
      productId: body.productId,
      kind: "link",
      metadata: {
        access: body.access,
        purpose: body.purpose,
        title: body.title,
      },
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Patch("authoring/product-artifacts/:artifactId")
  @ApiOperation({
    operationId: "updateProductArtifact",
    summary: "Change the name, purpose or access class of one Product Artifact",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(metadataSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 422, 503)
  async update(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
    @Body() input: unknown,
  ) {
    const body = parseBody(metadataSchema, input);
    const result = await this.artifacts.update({
      actor: account.accountId,
      artifactId,
      metadata: body,
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/product-artifacts/file")
  @ApiOperation({
    operationId: "replaceProductArtifactFile",
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
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 413, 422, 503)
  async replaceFile(
    @CurrentAccount() account: AuthenticatedAccount,
    @Req() request: FastifyRequest,
  ) {
    const upload = await readUpload(request, 3);
    const artifactId = uuidSchema.safeParse(field(upload.part, "artifactId"));
    if (!artifactId.success) {
      throw problemException(
        422,
        "invalid_artifact",
        "Product Artifact form is malformed",
      );
    }
    const result = await this.artifacts.replaceContent({
      actor: account.accountId,
      artifactId: artifactId.data,
      file: upload.file,
      kind: "file",
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/product-artifacts/:artifactId/link")
  @ApiOperation({
    operationId: "replaceProductArtifactLink",
    summary: "Replace the artifact content with a new external address version",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(replaceLinkBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 422, 503)
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
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/product-artifacts/:artifactId/archive")
  @ApiOperation({
    operationId: "setProductArtifactArchived",
    summary: "Archive one Product Artifact or return it from the archive",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(archiveBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 422, 503)
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
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/product-artifacts/:artifactId/products")
  @ApiOperation({
    operationId: "setProductArtifactProducts",
    summary: "Set the Products that reuse one artifact without copying it",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(productsBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 422, 503)
  async setProducts(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
    @Body() input: unknown,
  ) {
    const body = parseBody(productsBodySchema, input);
    const result = await this.artifacts.setProducts({
      actor: account.accountId,
      artifactId,
      productIds: body.productIds,
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Put("authoring/product-artifacts/:artifactId/materials")
  @ApiOperation({
    operationId: "setProductArtifactMaterials",
    summary: "Set the Materials one artifact belongs with inside its Products",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(materialsBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productArtifactHttpSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 422, 503)
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
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }

  @Post("authoring/import/products/:productId/artifacts")
  @ApiOperation({
    operationId: "importSourceProductArtifact",
    summary:
      "Create or update one authoring-owned artifact of a source Product from its package file",
  })
  @ApiParam({ name: "productId", schema: { format: "uuid", type: "string" } })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      properties: {
        ...multipartUploadFields,
        access: toOpenApiSchema(productArtifactAccessSchema),
        productSourceId: { maxLength: 200, minLength: 1, type: "string" },
        purpose: { maxLength: 1000, type: "string" },
        sourceId: { maxLength: 200, minLength: 1, type: "string" },
        title: { maxLength: 200, minLength: 1, type: "string" },
      },
      required: [
        "productSourceId",
        "sourceId",
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
  @ApiOkResponse({ schema: toOpenApiSchema(importOutcomeSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(400, 403, 404, 409, 413, 422, 503)
  async importFromSource(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("productId") productId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!uuidSchema.safeParse(productId).success) {
      throw problemException(
        400,
        "invalid_artifact",
        "Product Artifact request is malformed",
      );
    }
    const upload = await readUpload(request, sourceImportFieldLimit);
    const metadata = metadataSchema.safeParse({
      access: field(upload.part, "access"),
      purpose: field(upload.part, "purpose") ?? "",
      title: field(upload.part, "title") ?? "",
    });
    const sourceId = authoringSourceIdSchema.safeParse(
      field(upload.part, "sourceId"),
    );
    const productSourceId = authoringSourceIdSchema.safeParse(
      field(upload.part, "productSourceId"),
    );
    if (!metadata.success || !sourceId.success || !productSourceId.success) {
      throw problemException(
        422,
        "invalid_artifact",
        "Product Artifact form is malformed",
      );
    }
    const result = await this.artifacts.applyAuthoringImport({
      actor: account.accountId,
      artifacts: [
        { ...metadata.data, file: upload.file, sourceId: sourceId.data },
      ],
      productId,
      productSourceId: productSourceId.data,
    });
    if (!result.ok) throwProductArtifactError(result.error);
    // One artifact per request: other authoring artifacts are reported as missing by design and ignored here.
    const outcome = result.value.outcomes.find(
      (item) => item.sourceId === sourceId.data,
    );
    if (outcome === undefined)
      throw problemException(
        422,
        "invalid_artifact",
        "Product Artifact import has no outcome",
      );
    return outcome;
  }

  @Delete("authoring/product-artifacts/:artifactId")
  @ApiOperation({
    operationId: "removeProductArtifact",
    summary:
      "Remove one Product Artifact that no Product or Material still references",
  })
  @ApiParam({ name: "artifactId", schema: { format: "uuid", type: "string" } })
  @ApiOkResponse({ schema: toOpenApiSchema(removedArtifactSchema) })
  @ApiMaterialAuthoringErrors(401, 500)
  @ApiProductArtifactErrors(403, 404, 409, 503)
  async remove(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("artifactId") artifactId: string,
  ) {
    const result = await this.artifacts.remove({
      actor: account.accountId,
      artifactId,
    });
    if (!result.ok) throwProductArtifactError(result.error);
    return result.value;
  }
}

async function readUpload(
  request: FastifyRequest,
  fields: number,
): Promise<{
  readonly file: UploadedArtifactFile;
  readonly part: MultipartFile;
}> {
  let part: MultipartFile;
  try {
    const uploaded = await request.file({
      limits: { fields, fileSize: MATERIAL_ASSET_LIMITS.fileBytes, files: 1 },
    });
    if (uploaded === undefined) throw new Error("missing file");
    part = uploaded;
  } catch {
    // Not a dependency failure: the client sent a malformed form.
    throw problemException(
      422,
      "invalid_artifact",
      "Product Artifact form is malformed",
    );
  }
  let body: Buffer;
  try {
    body = await part.toBuffer();
  } catch {
    // Not a dependency failure: the upload exceeds its size limit.
    throw problemException(
      413,
      "invalid_content",
      "Product Artifact exceeds the size limit",
    );
  }
  if (part.file.truncated) {
    throw problemException(
      413,
      "invalid_content",
      "Product Artifact exceeds the size limit",
    );
  }
  const declaredSize = Number(field(part, "declaredSize"));
  const checksum = checksumSchema.safeParse(field(part, "checksumSha256"));
  if (
    !Number.isInteger(declaredSize) ||
    declaredSize < 1 ||
    !checksum.success
  ) {
    throw problemException(
      422,
      "invalid_artifact",
      "Product Artifact form is malformed",
    );
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
    throw problemException(
      422,
      "invalid_artifact",
      "Product Artifact request is malformed",
    );
  }
  return parsed.data;
}

function throwProductArtifactError(error: ProductArtifactError): never {
  switch (error.code) {
    case "forbidden":
      throw problemException(
        403,
        error.code,
        "Product Artifact change is forbidden",
      );
    case "artifact_not_found":
      throw problemException(404, error.code, "Product Artifact was not found");
    case "product_not_found":
      throw problemException(404, error.code, "Product was not found");
    case "material_not_found":
      throw problemException(404, error.code, "Material was not found");
    case "artifact_referenced":
      throw problemException(
        409,
        error.code,
        "Product Artifact is still referenced",
        {
          productIds: error.productIds,
        },
      );
    case "source_conflict":
      throw problemException(
        409,
        error.code,
        "Authoring source identifiers repeat",
      );
    case "invalid_content":
      throw problemException(
        422,
        error.code,
        "Product Artifact content is not accepted",
      );
    case "invalid_artifact":
      throw problemException(
        422,
        error.code,
        "Product Artifact request is malformed",
      );
    case "dependency_unavailable":
      throw problemException(
        503,
        error.code,
        "Product Artifact dependency is unavailable",
      );
  }
}
