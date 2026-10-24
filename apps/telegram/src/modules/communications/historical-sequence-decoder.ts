import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import historical from "@inside/contracts/inside-communications-v1/schema.json" with { type: "json" };
import current from "@inside/contracts/inside-communications-v2/schema.json" with { type: "json" };
import type { CommunicationSequenceDraft } from "./sequence-types.js";
import type { BroadcastAudience } from "./communications-contract.js";

type HistoricalDraft = Omit<CommunicationSequenceDraft, "sequenceId"> & {
  readonly funnelId: string;
};
function draftValidator<Shape>(
  schema: typeof historical | typeof current,
  name: "funnel" | "sequence",
): ValidateFunction<Shape> {
  const ajv = new Ajv.default({ strict: true });
  addFormats.default(ajv);
  ajv.addSchema(schema);
  const definition =
    name === "funnel"
      ? historical.definitions.funnel
      : current.definitions.sequence;
  const {
    revision: _revision,
    publishedRevision: _published,
    lifecycle: _lifecycle,
    ...properties
  } = definition.properties;
  const rewrittenProperties: unknown = JSON.parse(
    JSON.stringify(properties).replaceAll(
      '"#/definitions/',
      `"${schema.$id}#/definitions/`,
    ),
  );
  return ajv.compile<Shape>({
    type: "object",
    additionalProperties: false,
    properties: rewrittenProperties,
    required: Object.keys(properties),
  });
}
const validCurrent = draftValidator<CommunicationSequenceDraft>(
  current,
  "sequence",
);
const validHistorical = draftValidator<HistoricalDraft>(historical, "funnel");

/** Passive decoding of immutable published versions only. It never accepts a business command. */
export function decodeStoredSequenceDraft(
  value: unknown,
): CommunicationSequenceDraft {
  if (validCurrent(value)) return value;
  if (validHistorical(value)) {
    const { funnelId, ...facts } = value;
    return { ...facts, sequenceId: funnelId };
  }
  throw new Error("Invalid stored communication Sequence snapshot");
}

/** Historical broadcast audience snapshots remain byte-identical in storage. */
export function decodeStoredBroadcastAudience(
  value:
    | BroadcastAudience
    | { readonly kind: "funnels"; readonly funnelIds: readonly string[] },
): BroadcastAudience {
  if (value.kind === "funnels")
    return { kind: "sequences", sequenceIds: value.funnelIds };
  return value;
}
