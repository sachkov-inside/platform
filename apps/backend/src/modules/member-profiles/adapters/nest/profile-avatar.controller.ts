import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from "@nestjs/swagger";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { AssetDeliveryCache } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  CurrentAccount,
  OptionalAccountGuard,
  OptionalCurrentAccount,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import type {
  ChangeProfileAvatarResult,
  MemberProfiles,
} from "../../facets/member-profiles/member-profiles.interface.js";
import { PROFILE_AVATAR_LIMITS } from "../../features/change-profile-avatar/process-profile-avatar.js";
import { MEMBER_PROFILES } from "../../member-profiles.token.js";
import { memberProfileResponseSchema } from "./member-profile-http.contract.js";
import {
  ApiMemberProfileErrors,
  MemberProfileEndpoint,
} from "./member-profile-endpoint.js";

const checksumSchema = z.hash("sha256");
const cropSchema = z
  .object({
    centerX: z.number().min(0).max(1),
    centerY: z.number().min(0).max(1),
    zoom: z.number().min(1).max(4),
  })
  .strict();
const removeSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const uuidSchema = z.uuid();
const avatarSizeSchema = z.union([z.literal(160), z.literal(320), z.literal(640)]);

@MemberProfileEndpoint()
@ApiBearerAuth("logto")
@UseGuards(AccountGuard)
@Controller("account/profile/avatar")
export class PrivateProfileAvatarController {
  constructor(@Inject(MEMBER_PROFILES) private readonly profiles: MemberProfiles) {}

  @Put()
  @ApiOperation({ operationId: "uploadProfileAvatar", summary: "Crop and replace the current Account owner Profile avatar" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["expectedVersion", "crop", "declaredSize", "checksumSha256", "file"],
      properties: {
        expectedVersion: { type: "integer", minimum: 1 },
        crop: { type: "string", description: "JSON normalized crop with centerX, centerY, and zoom" },
        declaredSize: { type: "integer", minimum: 1, maximum: PROFILE_AVATAR_LIMITS.bytes },
        checksumSha256: toOpenApiSchema(checksumSchema),
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiOkResponse({ schema: toOpenApiSchema(memberProfileResponseSchema) })
  @ApiMemberProfileErrors(401, 500)
  @ApiResponse({ status: 404, content: problemDetailsContent(avatarProblemSchema(404)) })
  @ApiResponse({ status: 409, content: problemDetailsContent(avatarProblemSchema(409)) })
  @ApiResponse({ status: 413, content: problemDetailsContent(avatarProblemSchema(413)) })
  @ApiResponse({ status: 422, content: problemDetailsContent(avatarProblemSchema(422)) })
  @ApiResponse({ status: 503, content: problemDetailsContent(avatarProblemSchema(503)) })
  async upload(
    @CurrentAccount() account: AuthenticatedAccount,
    @Req() request: FastifyRequest,
  ) {
    let file: MultipartFile;
    try {
      const part = await request.file({
        limits: { fields: 4, fileSize: PROFILE_AVATAR_LIMITS.bytes, files: 1 },
      });
      if (part === undefined) throw new Error("missing file");
      file = part;
    } catch {
      throw avatarProblem(422, "invalid_avatar", "Avatar form is malformed");
    }
    let body: Buffer;
    try {
      body = await file.toBuffer();
    } catch {
      throw avatarProblem(413, "image_too_large", "Avatar exceeds the size limit");
    }
    if (file.file.truncated) {
      throw avatarProblem(413, "image_too_large", "Avatar exceeds the size limit");
    }
    const expectedVersion = Number(field(file, "expectedVersion"));
    const declaredSize = Number(field(file, "declaredSize"));
    const checksum = checksumSchema.safeParse(field(file, "checksumSha256"));
    const crop = parseCrop(field(file, "crop"));
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1 ||
      !Number.isInteger(declaredSize) ||
      declaredSize < 1 ||
      !checksum.success ||
      crop === null
    ) {
      throw avatarProblem(422, "invalid_avatar", "Avatar metadata is malformed");
    }
    const result = await this.profiles.changeAvatar({
      accountId: accountId(account.accountId),
      body,
      crop,
      declaredContentType: file.mimetype,
      declaredSize,
      expectedChecksumSha256: checksum.data,
      expectedVersion,
      kind: "upload",
    });
    if (!result.ok) throwAvatarError(result.error);
    return { profile: result.profile };
  }

  @Delete()
  @ApiOperation({ operationId: "removeProfileAvatar", summary: "Remove the current Account owner Profile avatar" })
  @ApiBody({ schema: toOpenApiSchema(removeSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(memberProfileResponseSchema) })
  @ApiMemberProfileErrors(401, 500)
  @ApiResponse({ status: 404, content: problemDetailsContent(avatarProblemSchema(404)) })
  @ApiResponse({ status: 409, content: problemDetailsContent(avatarProblemSchema(409)) })
  @ApiResponse({ status: 422, content: problemDetailsContent(avatarProblemSchema(422)) })
  @ApiResponse({ status: 503, content: problemDetailsContent(avatarProblemSchema(503)) })
  async remove(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = removeSchema.safeParse(input);
    if (!body.success) {
      throw avatarProblem(422, "invalid_avatar", "Avatar removal metadata is malformed");
    }
    const result = await this.profiles.changeAvatar({
      accountId: accountId(account.accountId),
      expectedVersion: body.data.expectedVersion,
      kind: "remove",
    });
    if (!result.ok) throwAvatarError(result.error);
    return { profile: result.profile };
  }
}

@MemberProfileEndpoint()
@ApiBearerAuth("logto")
@UseGuards(OptionalAccountGuard)
@Controller("member-profiles")
export class ProfileAvatarDeliveryController {
  constructor(@Inject(MEMBER_PROFILES) private readonly profiles: MemberProfiles) {}

  @Get(":publicProfileId/avatar/:avatarId/:size")
  @Header("X-Robots-Tag", "noindex, nofollow")
  @AssetDeliveryCache()
  @ApiOperation({ operationId: "readProfileAvatar", summary: "Read a current Profile avatar rendition through current membership" })
  @ApiParam({ name: "publicProfileId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "avatarId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "size", schema: { type: "integer", enum: [160, 320, 640] } })
  @ApiFoundResponse({
    description: "Short-lived protected avatar redirect",
    headers: { Location: { schema: { type: "string", format: "uri" } } },
  })
  @ApiMemberProfileErrors(401, 500)
  @ApiResponse({ status: 404, content: problemDetailsContent(avatarProblemSchema(404)) })
  @ApiResponse({ status: 503, content: problemDetailsContent(avatarProblemSchema(503)) })
  async read(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("publicProfileId") publicProfileId: string,
    @Param("avatarId") avatarId: string,
    @Param("size") rawSize: string,
  ) {
    const size = avatarSizeSchema.safeParse(Number(rawSize));
    if (
      account === undefined ||
      !uuidSchema.safeParse(publicProfileId).success ||
      !uuidSchema.safeParse(avatarId).success ||
      !size.success
    ) {
      throw avatarProblem(404, "profile_not_found", "Profile avatar is not available");
    }
    const result = await this.profiles.deliverAvatar({
      avatarId,
      publicProfileId,
      size: size.data,
      viewerAccountId: accountId(account.accountId),
    });
    if (!result.ok) {
      if (result.error.code === "dependency_unavailable") {
        throw avatarProblem(503, result.error.code, "Profile avatar dependency is unavailable");
      }
      throw avatarProblem(404, "profile_not_found", "Profile avatar is not available");
    }
    return {
      cacheScope: "private-no-store" as const,
      kind: "redirect" as const,
      location: result.location,
    };
  }
}

function field(file: MultipartFile, name: string): string | undefined {
  const value = file.fields[name];
  return value === undefined || Array.isArray(value) || value.type !== "field"
    ? undefined
    : String(value.value);
}

function parseCrop(value: string | undefined): z.infer<typeof cropSchema> | null {
  if (value === undefined) return null;
  try {
    const result = cropSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function throwAvatarError(
  error: Extract<ChangeProfileAvatarResult, { ok: false }>["error"],
): never {
  switch (error.code) {
    case "conflict":
      throw new HttpException(
        {
          code: error.code,
          currentVersion: error.currentVersion,
          status: 409,
          title: "Profile changed concurrently",
          type: "urn:inside:problem:member-profile-conflict",
        },
        409,
      );
    case "profile_not_found":
      throw avatarProblem(404, error.code, "Profile was not found");
    case "dependency_unavailable":
      throw avatarProblem(503, error.code, "Profile avatar dependency is unavailable");
    case "invalid_avatar": {
      const status = error.reason === "image_too_large" || error.reason === "size_mismatch" ? 413 : 422;
      throw new HttpException(
        {
          code: error.code,
          reason: error.reason,
          status,
          title: "Avatar image is not accepted",
          type: "urn:inside:problem:member-profile-invalid-avatar",
        },
        status,
      );
    }
  }
}

function avatarProblem(status: number, code: string, title: string): HttpException {
  return new HttpException(
    { code, status, title, type: `urn:inside:problem:${code.replaceAll("_", "-")}` },
    status,
  );
}

function avatarProblemSchema(status: number) {
  const base = z.object({
    code: z.string(),
    reason: z.string().optional(),
    status: z.literal(status),
    title: z.string(),
    type: z.string(),
  });
  return status === 409
    ? base.extend({ currentVersion: z.number().int().positive() }).loose()
    : base.loose();
}
