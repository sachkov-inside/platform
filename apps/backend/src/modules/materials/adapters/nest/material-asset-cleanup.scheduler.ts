import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { MATERIAL_ASSETS, type MaterialAssets } from "../../../assets/index.js";
import {
  MATERIAL_CONTENT,
  type MaterialContent,
} from "../../facets/material-content/material-content.js";

@Injectable()
export class MaterialAssetCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(MATERIAL_ASSETS) private readonly assets: MaterialAssets,
    @Inject(MATERIAL_CONTENT) private readonly materials: MaterialContent,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  onModuleInit(): void {
    const intervalMs = Math.max(
      60_000,
      Math.min(3_600_000, Math.floor(this.config.objectStorage.orphanGraceMs / 2)),
    );
    this.timer = setInterval(() => { void this.cleanup(); }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async cleanup(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.assets.cleanupOrphans({
        graceMs: this.config.objectStorage.orphanGraceMs,
        isReferenced: (input) => this.materials.containsAssetReference(input),
      });
    } catch {
      // Cleanup is retryable and must never make the API process unavailable.
    } finally {
      this.running = false;
    }
  }
}
