import { Controller, Get, Inject } from "@nestjs/common";
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { ViewerAwareCatalogCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsOneOfContent,
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
  anonymousSubject,
  CONTENT_ACCESS,
  type ContentAccess,
} from "../../../content-access/index.js";
import {
  PUBLISHED_MATERIAL_READER,
  publishedMaterialProblemHttpSchema,
  type PublishedMaterialReader,
} from "../../../materials/index.js";
import { VIDEOS, type Videos } from "../../../videos/index.js";
import {
  MEMBERSHIP_ENTITLEMENTS,
  type MembershipEntitlements,
} from "../../../membership-entitlements/index.js";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import { throwContentLibraryError } from "../../adapters/nest/content-library-http-errors.js";
import {
  publishedCatalogFacetHttpSchema,
  publishedCatalogItemHttpSchema,
} from "../../shared/published-catalog-http.js";
import { readHomeContent } from "./read-home-content.js";

const homeContentHttpSchema = z
  .object({
    topics: z.array(publishedCatalogFacetHttpSchema),
    playlists: z.array(publishedCatalogFacetHttpSchema),
    videos: z.array(publishedCatalogItemHttpSchema),
    guides: z.array(publishedCatalogItemHttpSchema),
    notes: z.array(publishedCatalogItemHttpSchema),
    membership: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("active") }).strict(),
      z
        .object({ acquisitionUrl: z.url(), kind: z.literal("inactive") })
        .strict(),
      z.object({ kind: z.literal("unknown") }).strict(),
    ]),
  })
  .strict();

@ApiTags("Content library")
@ViewerAwareCatalogCache()
@OptionalAccountEndpoint()
@Controller("library")
export class ReadHomeContentController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterialReader: Pick<
      PublishedMaterialReader,
      "listProjections"
    >,
    @Inject(CONTENT_ACCESS)
    private readonly contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
    @Inject(VIDEOS)
    private readonly videos: Pick<Videos, "loadReadyDurations">,
    @Inject(MEMBERSHIP_ENTITLEMENTS)
    private readonly membershipEntitlements: Pick<
      MembershipEntitlements,
      "resolveForAccess"
    >,
    @Inject(PLATFORM_CONFIG)
    private readonly config: PlatformConfig,
  ) {}

  @Get("home")
  @ApiOperation({
    operationId: "readHomeContent",
    summary: "Read the bounded real-data Home projection",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(homeContentHttpSchema) })
  @ApiInternalServerErrorResponse({
    description: "Home catalog or Account resolution failed internally",
    content: problemDetailsOneOfContent(
      publishedMaterialProblemHttpSchema,
      accountProblemSchema,
    ),
  })
  @ApiServiceUnavailableResponse({
    description: "Home catalog or Account dependency is unavailable",
    content: problemDetailsOneOfContent(
      publishedMaterialProblemHttpSchema,
      accountProblemSchema,
    ),
  })
  async read(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
  ) {
    const result = await readHomeContent(
      this.publishedMaterialReader,
      this.contentAccess,
      this.videos,
      this.membershipEntitlements,
      this.config.contentAccess.membershipAcquisitionUrl,
      account === undefined
        ? anonymousSubject
        : { kind: "account", accountId: accountId(account.accountId) },
    );
    if (!result.ok) throwContentLibraryError(result.error);
    return result.value;
  }
}
