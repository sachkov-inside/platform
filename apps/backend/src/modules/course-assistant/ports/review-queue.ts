/**
 * Очередь проверок практики (#788): API ставит проверку, отдельный worker выполняет её. Потерянная
 * постановка не теряет проверку: строка `queued` остаётся в базе, и worker подбирает её сам.
 */
export interface ReviewQueue {
  enqueue(reviewId: string): Promise<void>;
}
