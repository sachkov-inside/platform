import type {
  JsonObject,
  JsonValue,
  MaterialBody,
  MaterialBodySnapshot,
} from "./material-body.js";
import { isJsonArray } from "./json-guards.js";

function freezeJson(value: JsonValue): JsonValue {
  if (isJsonArray(value)) {
    return Object.freeze(value.map(freezeJson));
  }
  if (value !== null && typeof value === "object") {
    return freezeJsonObject(value);
  }
  return value;
}

function freezeJsonObject(value: JsonObject): JsonObject {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, freezeJson(child)]),
    ),
  );
}

export function restoreStoredMaterialBodyV1(
  snapshot: MaterialBodySnapshot,
): MaterialBody {
  // The brand records that this value passed the only persisted-body codec.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return Object.freeze({
    schemaVersion: 1,
    doc: freezeJsonObject(snapshot.doc),
  }) as MaterialBody;
}
