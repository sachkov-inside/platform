import { readAuthoringOverview } from "../features/read-authoring-overview/read-authoring-overview.js";
import { readProductOverview } from "../features/read-product-overview/read-product-overview.js";
import type {
  AuthoringOverview,
  ProductOverview,
} from "./overview-contract.js";
import type { OverviewDependencies } from "./overview-composition.js";

export type ReadAuthoringOverviewResult =
  | { readonly ok: true; readonly value: AuthoringOverview }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          "invalid_request" | "forbidden" | "dependency_unavailable";
      };
    };

export type ReadProductOverviewResult =
  | { readonly ok: true; readonly value: ProductOverview }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "invalid_request"
          | "forbidden"
          | "product_not_found"
          | "dependency_unavailable";
      };
    };

/** The Overview reads both controllers call (#1719); see each operation. */
export class AuthoringOverviewReads {
  constructor(private readonly dependencies: OverviewDependencies) {}

  readAuthoringOverview(
    actorId: string,
    input: unknown,
  ): Promise<ReadAuthoringOverviewResult> {
    return readAuthoringOverview(this.dependencies, actorId, input);
  }

  readProductOverview(
    actorId: string,
    productId: string,
    input: unknown,
  ): Promise<ReadProductOverviewResult> {
    return readProductOverview(this.dependencies, actorId, productId, input);
  }
}
