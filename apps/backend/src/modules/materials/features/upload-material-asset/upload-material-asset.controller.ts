import {
  Controller,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from "@nestjs/swagger";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { problemDetailsContent, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { MATERIAL_ASSET_LIMITS } from "../../../assets/index.js";
import { MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { materialIdSchema } from "../../adapters/nest/material-authoring-http.js";
import {
  MATERIAL_ASSET_AUTHORING,
  type MaterialAssetAuthoring,
  type UploadMaterialAssetForAuthoringResult,
} from "./upload-material-asset.js";

const checksumSchema = z.hash("sha256");
const assetIdempotencyKeySchema = z.string().trim().min(1).max(128);
const uploadResponseSchema = z.object({
  assetId: z.uuid(),
  contentType: z.string(),
  filename: z.string(),
  height: z.number().int().positive().optional(),
  kind: z.enum(["file", "image"]),
  size: z.number().int().positive(),
  state: z.literal("ready"),
  variants: z.array(z.object({ height: z.number().int().positive(), width: z.number().int().positive() })).optional(),
  width: z.number().int().positive().optional(),
});

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class UploadMaterialAssetController {
  constructor(
    @Inject(MATERIAL_ASSET_AUTHORING)
    private readonly assetAuthoring: MaterialAssetAuthoring,
  ) {}

  @Post(":materialId/assets")
  @ApiOperation({ operationId: "uploadMaterialAsset", summary: "Upload and finalize an immutable Material asset" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiHeader({ name: "idempotency-key", required: true, schema: toOpenApiSchema(assetIdempotencyKeySchema) })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: {
    type: "object",
    required: ["file", "kind", "declaredSize", "checksumSha256"],
    properties: {
      file: { type: "string", format: "binary" },
      kind: { type: "string", enum: ["file", "image"] },
      declaredSize: { type: "integer", minimum: 1, maximum: MATERIAL_ASSET_LIMITS.fileBytes },
      checksumSha256: toOpenApiSchema(checksumSchema),
    },
  } })
  @ApiCreatedResponse({ schema: toOpenApiSchema(uploadResponseSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(uploadProblemSchema(400, ["invalid_upload"])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(uploadProblemSchema(401, ["account_not_found", "authentication_required", "invalid_proof"])) })
  @ApiResponse({ status: 403, content: problemDetailsContent(uploadProblemSchema(403, ["forbidden"])) })
  @ApiResponse({ status: 404, content: problemDetailsContent(uploadProblemSchema(404, ["material_not_found"])) })
  @ApiResponse({ status: 409, content: problemDetailsContent(uploadProblemSchema(409, ["idempotency_key_reused", "upload_in_progress"])) })
  @ApiResponse({ status: 413, content: problemDetailsContent(uploadProblemSchema(413, ["image_too_large", "size_mismatch", "upload_too_large"])) })
  @ApiResponse({ status: 422, content: problemDetailsContent(uploadProblemSchema(422, ["checksum_mismatch", "executable_content", "image_decode_failed", "invalid_upload", "mime_mismatch", "unsupported_image_type"])) })
  @ApiResponse({ status: 500, content: problemDetailsContent(uploadProblemSchema(500, ["internal_error"])) })
  @ApiResponse({ status: 503, content: problemDetailsContent(uploadProblemSchema(503, ["dependency_unavailable"])) })
  async upload(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    let file: MultipartFile;
    try {
      const part = await request.file({
        limits: { fields: 4, fileSize: MATERIAL_ASSET_LIMITS.fileBytes, files: 1 },
      });
      if (part === undefined) throw new Error("missing file");
      file = part;
    } catch {
      throw uploadProblem(400, "invalid_upload", "Upload form is malformed");
    }
    let body: Buffer;
    try {
      body = await file.toBuffer();
    } catch {
      throw uploadProblem(413, "upload_too_large", "Uploaded file exceeds the size limit");
    }
    if (file.file.truncated) {
      throw uploadProblem(413, "upload_too_large", "Uploaded file exceeds the size limit");
    }
    const kind = field(file, "kind");
    const declaredSize = Number(field(file, "declaredSize"));
    const checksum = field(file, "checksumSha256");
    const parsedChecksum = checksumSchema.safeParse(checksum);
    const parsedIdempotencyKey = assetIdempotencyKeySchema.safeParse(idempotencyKey);
    if (
      (kind !== "file" && kind !== "image") ||
      !parsedChecksum.success ||
      !Number.isInteger(declaredSize) ||
      declaredSize < 1 ||
      !parsedIdempotencyKey.success ||
      !materialIdSchema.safeParse(materialId).success
    ) {
      throw uploadProblem(400, "invalid_upload", "Upload metadata is malformed");
    }
    const result = await this.assetAuthoring.upload({
      actor: account.accountId,
      body,
      declaredContentType: file.mimetype,
      declaredSize,
      expectedChecksumSha256: parsedChecksum.data,
      filename: file.filename,
      idempotencyKey: parsedIdempotencyKey.data,
      kind,
      materialId,
    });
    if (!result.ok) throwAssetUploadError(result.error);
    return result.value;
  }
}

function field(file: MultipartFile, name: string): string | undefined {
  const value = file.fields[name];
  if (value === undefined || Array.isArray(value) || value.type !== "field") return undefined;
  return String(value.value);
}

function throwAssetUploadError(error: Extract<UploadMaterialAssetForAuthoringResult, { ok: false }>["error"]): never {
  switch (error.code) {
    case "dependency_unavailable": throw uploadProblem(503, error.code, "Material asset dependency is unavailable");
    case "forbidden": throw uploadProblem(403, error.code, "Material asset upload is forbidden");
    case "material_not_found": throw uploadProblem(404, error.code, "Material was not found");
    case "idempotency_key_reused":
    case "upload_in_progress": throw uploadProblem(409, error.code, "Material asset upload conflicts with an existing request");
    case "image_too_large":
    case "size_mismatch": throw uploadProblem(413, error.code, "Uploaded file exceeds or does not match its declared size");
    case "checksum_mismatch":
    case "executable_content":
    case "image_decode_failed":
    case "invalid_upload":
    case "mime_mismatch":
    case "unsupported_image_type": throw uploadProblem(422, error.code, "Uploaded bytes are not an accepted Material asset");
  }
}

function uploadProblem(status: number, code: string, title: string): HttpException {
  return new HttpException({ type: `urn:inside:problem:${code}`, title, status, code }, status);
}

function uploadProblemSchema(
  status: number,
  codes: readonly [string, ...string[]],
) {
  return z.object({
    code: z.enum(codes),
    status: z.literal(status),
    title: z.string(),
    type: z.string(),
  }).loose();
}
