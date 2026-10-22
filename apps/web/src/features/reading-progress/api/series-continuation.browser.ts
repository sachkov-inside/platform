import type { SeriesContinuationView } from "../model/series-continuation-contract";
import { loadSeriesContinuationOperation } from "./reading-progress.operation";

export function loadSeriesContinuation(
  slug: string,
): Promise<SeriesContinuationView> {
  return loadSeriesContinuationOperation.send({ slug });
}
