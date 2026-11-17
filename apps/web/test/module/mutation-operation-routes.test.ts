import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { z } from "zod";

import type { MutationOperation } from "@/shared/api/mutation-operation";

import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import { realBffSession } from "../support/real-bff-session";
import { routeBrowserMutations as connectBrowserMutations } from "../support/mutation-operation-route";

/** Operations a guest may send: their route answers without a session, so only Origin is checked. */
const guestOperations = new Set([
  "createMaterialVideoPlaybackSessionOperation",
  "beginWaitlistIntentOperation",
]);

type AnyOperation = MutationOperation<z.ZodType, z.ZodType>;

interface FailureContract {
  readonly names: readonly string[];
  readonly responses: Readonly<Record<401 | 403, unknown>>;
}
const failureContracts: readonly FailureContract[] = [
  {
    names: [
      "createContentCollectionOperation",
      "updateContentCollectionOperation",
      "setContentCollectionArchiveOperation",
      "createMaterialDraftOperation",
      "saveMaterialOperation",
      "beginTelegramLinkOperation",
      "confirmTelegramLinkOperation",
      "createAccountProfileOperation",
      "updateAccountProfileOperation",
      "transitionMaterialPublicationOperation",
      "deleteMaterialDraftOperation",
      "createProductArtifactFromLinkOperation",
      "updateProductArtifactOperation",
      "replaceProductArtifactLinkOperation",
      "setProductArtifactArchivedOperation",
      "setProductArtifactProductsOperation",
      "removeProductArtifactOperation",
      "reorderProductOperation",
    ],
    responses: {
      "401": {
        value: {
          kind: "unauthorized",
        },
      },
      "403": {
        value: {
          kind: "unauthorized",
        },
      },
    },
  },
  {
    names: [
      "saveAuthorFeedbackOperation",
      "getBookmarkStatesOperation",
      "readExerciseAttemptsOperation",
      "recordExerciseAttemptOperation",
      "readLessonRatingOperation",
      "setLessonRatingOperation",
      "readLessonStatisticsOperation",
      "setHomePinOperation",
      "submitProductTaskOperation",
      "recordMaterialOpenOperation",
      "recordOpenedPartsOperation",
      "getReadingStatesOperation",
      "setReadingStateOperation",
      "acceptTermsOperation",
    ],
    responses: {
      "401": {
        value: {
          kind: "unauthorized",
        },
      },
      "403": {
        value: {
          kind: "unavailable",
        },
      },
    },
  },
  {
    names: [
      "acceptBillingConsentsOperation",
      "issueProductAccessOperation",
      "restoreProductAccessOperation",
      "previewProductRevocationOperation",
      "revokeProductAccessOperation",
      "startAccountEmailOperation",
      "confirmAccountEmailOperation",
      "createBillingQuoteOperation",
      "startBillingPurchaseOperation",
      "startBillingContactOperation",
      "confirmBillingContactOperation",
      "listCourseActivationRulesOperation",
      "saveCourseActivationRuleOperation",
      "changeNotificationPreferencesOperation",
      "reconcilePaymentOperation",
      "createOwnerPaymentLinkOperation",
      "revokeOwnerPaymentLinkOperation",
      "listOwnerPaymentLinksOperation",
      "archiveProductPriceOperation",
      "readOwnerProductPriceOperation",
      "saveProductPriceOperation",
      "saveProductSalesStateOperation",
      "savePromotionOperation",
      "archivePromotionOperation",
      "listPromotionsOperation",
      "readQuestionnaireRespondentsOperation",
    ],
    responses: {
      "401": {
        value: {
          ok: false,
          code: "unauthorized",
        },
      },
      "403": {
        value: {
          ok: false,
          code: "unavailable",
        },
      },
    },
  },
  {
    names: [
      "initMaterialVideoUploadOperation",
      "attachMaterialVideoOperation",
      "reconcileMaterialVideoOperation",
      "retryMaterialVideoDeletionOperation",
      "beginWaitlistIntentOperation",
      "joinWaitlistOperation",
      "withdrawWaitlistOperation",
    ],
    responses: {
      "401": {
        value: {
          kind: "unavailable",
        },
      },
      "403": {
        value: {
          kind: "unavailable",
        },
      },
    },
  },
  {
    names: ["createMaterialVideoPlaybackSessionOperation"],
    responses: {
      "401": {
        value: null,
      },
      "403": {
        value: null,
      },
    },
  },
  {
    names: ["saveMaterialVideoProgressOperation"],
    responses: {
      "401": {
        value: false,
      },
      "403": {
        value: false,
      },
    },
  },
  {
    names: ["setBookmarkOperation"],
    responses: {
      "401": {
        value: {
          kind: "unauthorized",
        },
      },
      "403": {
        value: {
          kind: "denied",
        },
      },
    },
  },
  {
    names: ["updateChapterAttachmentsOperation"],
    responses: {
      "401": {
        value: {
          kind: "unauthorized",
        },
      },
      "403": {
        value: {
          kind: "error",
          reference: "chapter-attachments-unavailable",
        },
      },
    },
  },
  {
    names: ["updateProductTopicsOperation"],
    responses: {
      "401": {
        value: {
          kind: "unauthorized",
        },
      },
      "403": {
        value: {
          kind: "error",
          reference: "product-topics-unavailable",
        },
      },
    },
  },
  {
    names: ["loadPersonalHomeOperation"],
    responses: {
      "401": {
        value: {
          kind: "hidden",
        },
      },
      "403": {
        rejected: "Personal Home is unavailable",
      },
    },
  },
  {
    names: ["loadProductContinuationOperation"],
    responses: {
      "401": {
        value: {
          kind: "hidden",
        },
      },
      "403": {
        value: {
          kind: "unavailable",
        },
      },
    },
  },
];
const expectedFailures = new Map<
  string,
  Readonly<Record<401 | 403, unknown>>
>();
for (const contract of failureContracts)
  for (const name of contract.names) {
    if (expectedFailures.has(name))
      throw new Error(`Duplicate operation contract ${name}`);
    expectedFailures.set(name, contract.responses);
  }
function expectedOutcome(name: string, status: 401 | 403): unknown {
  const expected = expectedFailures.get(name);
  if (expected === undefined)
    throw new Error(`Missing explicit operation contract ${name}`);
  return expected[status];
}

const moduleExports = z.record(z.string(), z.unknown());
const webRoot = fileURLToPath(new URL("../..", import.meta.url));

function operationModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return operationModules(entryPath);
    return entry.name.endsWith(".operation.ts") ? [entryPath] : [];
  });
}

function isOperation(value: unknown): value is AnyOperation {
  return (
    typeof value === "object" &&
    value !== null &&
    "send" in value &&
    "path" in value &&
    "method" in value
  );
}

const operations = await Promise.all(
  operationModules(path.join(webRoot, "src")).map(async (file) => {
    const exports = moduleExports.parse(await import(file));
    return Object.entries(exports).flatMap(([name, value]) =>
      isOperation(value) ? [{ file, name, operation: value }] : [],
    );
  }),
).then((lists) => lists.flat());

async function routeModule(operationPath: string) {
  const routes = moduleExports.parse(
    await import(path.join(webRoot, "app", operationPath, "route.ts")),
  );
  return Object.fromEntries(
    Object.entries(routes).filter(
      (entry): entry is [string, (request: Request) => Promise<Response>] =>
        typeof entry[1] === "function",
    ),
  );
}

/** What a call produced: its value, or the message it rejected with. */
async function outcome(call: () => unknown): Promise<unknown> {
  try {
    return { value: await call() };
  } catch (error) {
    return { rejected: error instanceof Error ? error.message : String(error) };
  }
}

let scope: Awaited<ReturnType<typeof realBffSession>>;
let sessionRead: MockInstance<typeof sessionAdapter.accessToken>;
const unexpectedBackend: string[] = [];
function routeBrowserMutations(
  routes: Parameters<typeof connectBrowserMutations>[0],
  origin = "https://inside.example.test",
) {
  return connectBrowserMutations(routes, origin, {
    run: scope,
    externalFetch: (request) => {
      unexpectedBackend.push(request.url);
      return Promise.reject(
        new Error(`Unexpected external request ${request.url}`),
      );
    },
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  scope = await realBffSession(null);
  sessionRead = vi.spyOn(sessionAdapter, "accessToken");
  unexpectedBackend.length = 0;
});
afterEach(() => {
  try {
    expect(unexpectedBackend).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

/**
 * Every declared operation once through its browser adapter and the Route Handler of its literal
 * path: the shared boundary answers before any backend call, and the adapter maps that answer
 * through the operation's own outcome.
 */
describe("every mutation operation reaches its Route Handler", () => {
  it("finds the declared operations", () => {
    expect(operations.length).toBeGreaterThan(0);
    expect([...expectedFailures.keys()].sort()).toEqual(
      operations.map(({ name }) => name).sort(),
    );
  });

  it.each(
    operations
      .filter((entry) => !guestOperations.has(entry.name))
      .map((entry) => [entry.name, entry] as const),
  )(
    "%s refuses a missing session through its route",
    async (name, { operation }) => {
      const { requests, statuses } = routeBrowserMutations({
        [operation.path]: await routeModule(operation.path),
      });

      // Сессия проверяется раньше тела, поэтому достаточно любого объекта.
      const result = await outcome(() => operation.send({}));

      expect(requests[0]?.method).toBe(operation.method);
      expect(statuses).toEqual([401]);
      expect(result).toEqual(expectedOutcome(name, 401));
    },
  );

  it.each(operations.map((entry) => [entry.name, entry] as const))(
    "%s refuses another origin before the session",
    async (name, { operation }) => {
      const { statuses } = routeBrowserMutations(
        { [operation.path]: await routeModule(operation.path) },
        "https://outside.test",
      );

      const result = await outcome(() => operation.send({}));

      expect(result).toEqual(expectedOutcome(name, 403));
      expect(statuses).toEqual([403]);
      expect(sessionRead).not.toHaveBeenCalled();
    },
  );
});
