import type {
  AuthoringOverview,
  ProductOverview,
} from "./overview-contract.js";

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

/** The Overview reads both controllers call (#1719). */
export class AuthoringOverviewReads {
  readAuthoringOverview(
    _actorId: string,
    _input: unknown,
  ): Promise<ReadAuthoringOverviewResult> {
    return Promise.resolve({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
  }

  readProductOverview(
    _actorId: string,
    _productId: string,
    _input: unknown,
  ): Promise<ReadProductOverviewResult> {
    return Promise.resolve({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
  }
}
