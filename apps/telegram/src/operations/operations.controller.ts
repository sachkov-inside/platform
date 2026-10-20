import { CommunityProvider } from "../modules/community/community-provider.js";
import { WaitlistConfirmations } from "../modules/communications/waitlist-confirmations.js";
import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { sql } from "kysely";

import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../config/application-config.js";
import { DATABASE, type Database } from "../database/database.js";
import { MembershipEvidenceProvider } from "../modules/membership-evidence/membership-evidence-provider.js";
import { RuntimeMetrics } from "./runtime-metrics.js";

@Controller()
export class OperationsController {
  constructor(
    @Inject(WaitlistConfirmations)
    private readonly waitlistConfirmations: WaitlistConfirmations,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RuntimeMetrics) private readonly metrics: RuntimeMetrics,
    @Inject(APPLICATION_CONFIG)
    private readonly config: ApplicationConfig,
    @Inject(MembershipEvidenceProvider)
    private readonly membershipEvidence: MembershipEvidenceProvider,
    @Inject(CommunityProvider)
    private readonly community: Pick<CommunityProvider, "snapshot">,
  ) {}

  @Get("health")
  health(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<{ status: "ready" }> {
    try {
      await sql`select 1`.execute(this.database);
    } catch {
      throw new ServiceUnavailableException("Database is unavailable");
    }
    if (
      this.config.membershipMode === "live" &&
      this.membershipEvidence.readiness() !== "ready"
    ) {
      throw new ServiceUnavailableException(
        "Telegram Membership provider is unavailable",
      );
    }
    return { status: "ready" };
  }

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  async metricsText(): Promise<string> {
    this.metrics.recordWaitlistConfirmations(
      await this.waitlistConfirmations.snapshot(),
    );
    // Scrape persisted facts even if the community worker stopped after its last snapshot.
    if (this.config.communityMode === "live")
      this.metrics.recordCommunity(await this.community.snapshot());
    return this.metrics.render();
  }
}
