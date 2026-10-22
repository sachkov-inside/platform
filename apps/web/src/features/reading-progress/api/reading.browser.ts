import {
  getReadingStatesOperation,
  setReadingStateOperation,
} from "./reading-progress.operation";

export function getReadingStates(materialIds: readonly string[]) {
  return getReadingStatesOperation.send({ materialIds: [...materialIds] });
}

export const setReadingState = setReadingStateOperation.send;
