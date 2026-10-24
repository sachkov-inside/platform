import type { broadcastView } from "../../src/modules/communications/broadcasts.js";
import type {
  EntriesResult,
  StatisticsResult,
} from "../../src/modules/communications/communication-statistics.js";
import type { TemplateSnapshot } from "../../src/modules/communications/communications-contract.js";
import type { SequencePreview } from "../../src/modules/communications/sequence-preview.js";
import type {
  DeliverySnapshot,
  CommunicationSequenceSnapshot,
  IntroSnapshot,
} from "../../src/modules/communications/sequence-types.js";

/**
 * Body of a successful Communications API response as tests read it. Each operation fills only
 * the fields it returns; tests that need the exact shape also check it with the contract schema.
 */
export interface CommunicationsBody {
  readonly broadcast: ReturnType<typeof broadcastView>;
  readonly broadcasts: ReturnType<typeof broadcastView>[];
  readonly deliveries: DeliverySnapshot[];
  readonly entries: EntriesResult["entries"];
  readonly funnel: CommunicationSequenceSnapshot;
  readonly intro: IntroSnapshot;
  readonly nextCursor: string | null;
  readonly outcome: "skipped" | "retry_requested";
  readonly preview: SequencePreview;
  readonly safeUrl: string;
  readonly statistics: StatisticsResult["statistics"];
  readonly template: TemplateSnapshot;
  readonly templates: TemplateSnapshot[];
}
