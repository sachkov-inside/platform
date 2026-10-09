import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { bearerMatches } from "../../security/credentials.js";
import { BotSignIn, MalformedSignInRequestError } from "./bot-sign-in.js";
import {
  miniAppApprovalSchema,
  miniAppBindingSchema,
  miniAppRegistrationSchema,
  miniAppSignInContractVersion,
} from "./mini-app-sign-in.contract.js";

/** The existing connector consumes/finalizes through bot-sign-in v1 after launch approval. */
@Controller("integrations/identity/v1/sign-in/mini-app")
export class MiniAppSignInController {
  constructor(
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(BotSignIn) private readonly signIn: BotSignIn,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  async register(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.authenticate(authorization);
    const parsed = miniAppRegistrationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const request = parsed.data;
    try {
      return {
        contractVersion: miniAppSignInContractVersion,
        ...(await this.signIn.register({
          requestRef: request.requestRef,
          startTokenDigest: request.startTokenDigest,
          browserSecretDigest: request.browserSecretDigest,
          oidcContextDigest: request.oidcContextDigest,
          expiresAt: new Date(request.expiresAt),
          source: "mini-app",
        })),
      };
    } catch (error) {
      if (error instanceof MalformedSignInRequestError)
        throw new BadRequestException();
      throw error;
    }
  }

  @Post(":requestRef/approve")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  async approve(
    @Headers("authorization") authorization: string | undefined,
    @Param("requestRef") requestRef: string,
    @Body() body: unknown,
  ) {
    this.authenticate(authorization);
    const parsed = miniAppApprovalSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return {
      contractVersion: miniAppSignInContractVersion,
      ...(await this.signIn.approveMiniApp(
        requestRef,
        parsed.data.browserSecret,
        parsed.data.initData,
      )),
    };
  }

  private authenticate(authorization: string | undefined): void {
    if (!bearerMatches(authorization, this.config.signInIntegrationSecret))
      throw new UnauthorizedException();
  }

  @Post(":requestRef/bind")
  @Header("Cache-Control", "no-store")
  @HttpCode(200)
  async bind(
    @Headers("authorization") authorization: string | undefined,
    @Param("requestRef") requestRef: string,
    @Body() body: unknown,
  ) {
    this.authenticate(authorization);
    const parsed = miniAppBindingSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return {
      contractVersion: miniAppSignInContractVersion,
      ...(await this.signIn.bindMiniApp(
        requestRef,
        parsed.data.oidcContextDigest,
        parsed.data.browserSecretDigest,
        parsed.data.launchBrowserSecret,
      )),
    };
  }
}
