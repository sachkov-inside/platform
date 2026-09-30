import {
  readFunnelReport,
  type ReadFunnelReportDependencies,
} from "../../features/read-funnel-report/read-funnel-report.js";
import { recordBotEvents } from "../../features/record-bot-events/record-bot-events.js";

/** Bot funnel events in, the owner's aggregated report out. */
export class SalesFunnel {
  constructor(private readonly dependencies: ReadFunnelReportDependencies) {}

  recordBotEvents(input: unknown) {
    return recordBotEvents(this.dependencies, input);
  }

  readReport(actorId: string, input: unknown) {
    return readFunnelReport(this.dependencies, actorId, input);
  }
}
