import {
  createContentCollectionOperation,
  setContentCollectionArchiveOperation,
  updateContentCollectionOperation,
} from "./content-collections.operation";

export const createContentCollection = createContentCollectionOperation.send;

export const updateContentCollection = updateContentCollectionOperation.send;

export const setContentCollectionArchive =
  setContentCollectionArchiveOperation.send;
