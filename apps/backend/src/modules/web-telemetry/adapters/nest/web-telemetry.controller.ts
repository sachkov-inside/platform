import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { WebTelemetry } from "../../facets/web-telemetry/web-telemetry.js";

/** Private Compose-network ingress; Caddy explicitly refuses this path. */
@ApiExcludeController()
@Controller("internal/web-telemetry")
export class WebTelemetryController {
  constructor(@Inject(WebTelemetry) private readonly telemetry: WebTelemetry) {}
  @Post()
  @HttpCode(204)
  async record(@Body() input: unknown): Promise<void> {
    const result = await this.telemetry.record(input);
    if (result.ok) return;
    switch (result.error.code) {
      case "invalid_input":
        throw problemException(
          400,
          result.error.code,
          "Invalid telemetry report",
        );
      case "dependency_unavailable":
        throw problemException(503, result.error.code, "Telemetry unavailable");
    }
  }
}
