/** Synthetic facts. No production account, bank, Telegram chat or source repository is used. */
export const ids = {
  actor: "11111111-1111-4111-8111-111111111111",
  product: "22222222-2222-4222-8222-222222222222",
  chapter: "33333333-3333-4333-8333-333333333333",
  sequence: "44444444-4444-4444-8444-444444444444",
  step: "55555555-5555-4555-8555-555555555555",
  part: "66666666-6666-4666-8666-666666666666",
  operation: "77777777-7777-4777-8777-777777777777",
};
export const ground = {
  source: "manual",
  capabilities: ["community"],
  startsAt: "2026-10-01T00:00:00.000Z",
  validUntil: null,
  active: true,
};
export const payment = {
  purchaseRef: "88888888-8888-4888-8888-888888888888",
  kind: "one_time",
  state: "confirmed",
  amountKopecks: 10000,
  offerName: "Original accepted purchase",
  months: 1,
  fiscalization: "not_configured",
  confirmedAt: "2026-10-01T00:00:00.000Z",
  periodEndsAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  refundedKopecks: 0,
  refundedAt: null,
};
export function billing(overrides = {}) {
  return {
    products: [],
    access: { grounds: [ground] },
    notices: [],
    payments: [],
    ...overrides,
  };
}
export function ownAccess(value = ground) {
  return {
    ok: true,
    value: {
      contractVersion: "inside.subscription-activation.v1",
      enrollments: [],
      grounds: [value],
      products: [],
      admission: { state: "checking", admissionRestriction: null },
    },
  };
}
export const body = {
  schemaVersion: 1,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { nodeId: "99999999-9999-4999-8999-999999999999" },
        content: [
          {
            type: "text",
            text: "Original opaque source text: series and showInFeed",
          },
        ],
      },
    ],
  },
};
export const sourceInput = {
  source: {
    id: "fixture:original-material",
    path: "original.md",
    revision: "a".repeat(64),
    showInFeed: false,
  },
  publicationState: "draft",
  primaryVideoId: null,
  metadata: {
    title: "Original",
    summary: null,
    access: "free",
    difficulty: null,
    outcomes: [],
    topicId: null,
    formatId: "note",
    tagIds: [],
    seriesIds: [],
  },
  body,
};
export const definition = {
  schemaVersion: 1,
  situation: "Original situation",
  result: ["Original result"],
  freedom: "Original freedom",
  criteria: [
    {
      id: "one",
      level: "required",
      requirement: "Original requirement",
      acceptableEvidence: ["Original evidence"],
    },
  ],
};
export function task(definition_, code = "artifact-task") {
  return {
    sourceId: `fixture:${code}`,
    code,
    productId: ids.product,
    chapterId: ids.chapter,
    position: 1,
    title: "Preserved task",
    access: "free",
    definition: definition_,
    relatedMaterialSourceIds: [],
    publicationState: "unpublished",
    provenance: {
      repository: "fixture/transfer",
      commit: "b".repeat(40),
      path: `${code}.json`,
    },
  };
}
export function largeBytesDefinition() {
  const value = {
    ...definition,
    situation: "x",
    freedom: "x",
    criteria: [
      {
        ...definition.criteria[0],
        acceptableEvidence: Array.from({ length: 8 }, () => "e".repeat(16000)),
      },
    ],
    reviewGuidance: "x",
  };
  const target = 129 * 1024;
  value.reviewGuidance = "r".repeat(
    target - Buffer.byteLength(JSON.stringify(value)) + 1,
  );
  return value;
}
export function sequenceRequest(current = false) {
  return {
    contractVersion: current
      ? "inside-communications-v2"
      : "inside-communications-v1",
    operationId: ids.operation,
    operation: current ? "sequences.save" : "funnels.save",
    actor: { accountRef: "artifact-author" },
    expectedRevision: 0,
    payload: {
      [current ? "sequenceId" : "funnelId"]: ids.sequence,
      name: "Original funnel authored name",
      isDefault: false,
      sources: [],
      steps: [],
      entryResponse: {
        stepId: ids.step,
        parts: [
          {
            partId: ids.part,
            content: {
              type: "text",
              text: "Original immutable message",
              entities: [],
              buttons: [],
            },
          },
        ],
      },
    },
  };
}
