/** What one manual issue of Product Access answered (#1693): the owner decides, the web only names it. */
export type ProductAccessIssueOutcome = "issued" | "already_active" | "revoked";

/**
 * The owner's message for an issue outcome. A revoked Product is not issued again: only an explicit
 * restore in the person card returns it, so the message points there instead of retrying.
 */
export function issueOutcomeMessage(
  outcome: ProductAccessIssueOutcome,
): string {
  switch (outcome) {
    case "issued":
      return "Доступ выдан.";
    case "already_active":
      return "Доступ уже был, ничего не изменилось.";
    case "revoked":
      return "Доступ к продукту отозван, выдача его не возвращает. Верните его действием «Восстановить» в карточке человека.";
  }
}
