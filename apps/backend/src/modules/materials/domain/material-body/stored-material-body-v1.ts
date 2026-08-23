import type {
  JsonObject,
  JsonValue,
  MaterialBody,
  MaterialBodySnapshot,
} from "./material-body.js";

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeJson));
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, freezeJson(child)]),
      ),
    );
  }
  return value;
}

export function restoreStoredMaterialBodyV1(
  snapshot: MaterialBodySnapshot,
): MaterialBody {
  return Object.freeze({
    schemaVersion: 1,
    doc: freezeJson(snapshot.doc) as JsonObject,
  }) as MaterialBody;
}
