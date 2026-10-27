import { readContentCatalogOperation } from "./enrollments.operation";

export function readContentCatalog() {
  return readContentCatalogOperation.send({ operationId: crypto.randomUUID() });
}
