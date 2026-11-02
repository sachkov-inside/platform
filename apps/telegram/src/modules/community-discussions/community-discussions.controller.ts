import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
} from "@nestjs/common";
import { COMMUNITY_DISCUSSIONS_VERSION } from "@inside/contracts/community-discussions";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { bearerMatches } from "../../security/credentials.js";
import {
  CommunityDiscussions,
  CommunityDiscussionsError,
} from "./community-discussions.js";

@Controller("integrations/platform/v1/community-discussions")
export class CommunityDiscussionsController {
  constructor(
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CommunityDiscussions)
    private readonly discussions: CommunityDiscussions,
  ) {}
  @Post()
  @HttpCode(200)
  async execute(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      if (
        !bearerMatches(authorization, this.config.communityDiscussions?.secret)
      )
        throw new CommunityDiscussionsError("unauthorized");
      return await this.discussions.execute(body);
    } catch (error) {
      if (!(error instanceof CommunityDiscussionsError)) throw error;
      const statuses = {
        unauthorized: 401,
        forbidden: 403,
        authorization_unavailable: 503,
        malformed: 400,
        not_found: 404,
        operation_conflict: 409,
      };
      throw new HttpException(
        { contractVersion: COMMUNITY_DISCUSSIONS_VERSION, status: error.code },
        statuses[error.code],
      );
    }
  }
}
