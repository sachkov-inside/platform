import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { ViewerAwareCatalogCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountId as checkedAccountId,
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
import { throwContentLibraryError } from "../../adapters/nest/content-library-http-errors.js";
import {
  publishedSeriesPageHttpSchema,
  publishedTopicPageHttpSchema,
  relatedPublishedMaterialsHttpSchema,
} from "../../shared/published-catalog-http.js";
import { discoverPublishedMaterials } from "./discover-published-materials.js";

const TOPIC_METADATA_SIZE = 0;
const RELATED_SIZE = 6;
const discoverySlugSchema = toOpenApiSchema(
  z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
);

@ApiTags("Content library")
@ViewerAwareCatalogCache()
@OptionalAccountEndpoint()
@Controller("library")
export class DiscoverPublishedMaterialsController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterialReader: Pick<
      PublishedMaterialReader,
      "discoverProjections"
    >,
    @Inject(CONTENT_ACCESS)
    private readonly contentAccess: Pick<
      ContentAccess,
      "checkAvailabilityMany"
    >,
    @Inject(VIDEOS)
    private readonly videos: Pick<Videos, "loadReadyDurations">,
  ) {}

  @Get("topics/:slug")
  @ApiOperation({
    operationId: "readPublishedTopic",
    summary: "Read a generated Topic view",
  })
  @ApiParam({ name: "slug", required: true, schema: discoverySlugSchema })
  @ApiOkResponse({
    description: "Published Materials in the Topic",
    schema: toOpenApiSchema(publishedTopicPageHttpSchema),
  })
  @DiscoveryErrorResponses()
  readTopic(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") slug: string,
  ) {
    return this.read("topic", slug, TOPIC_METADATA_SIZE, account);
  }

  @Get("series/:slug")
  @ApiOperation({
    operationId: "readPublishedSeries",
    summary: "Read a generated ordered Series view",
  })
  @ApiParam({ name: "slug", required: true, schema: discoverySlugSchema })
  @ApiOkResponse({
    description: "Published Materials in author-defined Series order",
    schema: toOpenApiSchema(publishedSeriesPageHttpSchema),
  })
  @DiscoveryErrorResponses()
  readSeries(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") slug: string,
  ) {
    return this.read("series", slug, null, account);
  }

  @Get("materials/:slug/related")
  @ApiOperation({
    operationId: "readRelatedPublishedMaterials",
    summary: "Read deterministic related Materials",
  })
  @ApiParam({ name: "slug", required: true, schema: discoverySlugSchema })
  @ApiOkResponse({
    description: "Explicit pins followed by metadata-related Materials",
    schema: toOpenApiSchema(relatedPublishedMaterialsHttpSchema),
  })
  @DiscoveryErrorResponses()
  readRelated(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") slug: string,
  ) {
    return this.read("related", slug, RELATED_SIZE, account);
  }

  private async read(
    kind: "related" | "series" | "topic",
    slug: string,
    first: number | null,
    account: AuthenticatedAccount | undefined,
  ) {
    const result = await discoverPublishedMaterials(
      this.publishedMaterialReader,
      this.contentAccess,
      this.videos,
      {
        first,
        kind,
        slug,
        subject:
          account === undefined
            ? anonymousSubject
            : {
                kind: "account",
                accountId: checkedAccountId(account.accountId),
              },
      },
    );
    if (!result.ok) {
      throwContentLibraryError(result.error);
    }
    return result.value;
  }
}

function DiscoveryErrorResponses(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    ApiBadRequestResponse({
      description: "Discovery slug is malformed",
      content: problemDetailsContent(publishedMaterialProblemHttpSchema),
    })(target, propertyKey, descriptor);
    ApiNotFoundResponse({
      description: "Topic, Series or source Material is not published",
      content: problemDetailsContent(publishedMaterialProblemHttpSchema),
    })(target, propertyKey, descriptor);
    ApiInternalServerErrorResponse({
      description: "Discovery or Account resolution failed internally",
      content: problemDetailsOneOfContent(
        publishedMaterialProblemHttpSchema,
        accountProblemSchema,
      ),
    })(target, propertyKey, descriptor);
    ApiServiceUnavailableResponse({
      description: "Discovery or Account dependency is unavailable",
      content: problemDetailsOneOfContent(
        publishedMaterialProblemHttpSchema,
        accountProblemSchema,
      ),
    })(target, propertyKey, descriptor);
  };
}
