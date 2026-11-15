import { flushSync } from "react-dom";

/**
 * Неудачная отправка формы с `noValidate`: ошибки появляются сразу, и фокус переходит на первое
 * поле с ошибкой. Человек с клавиатурой или экранной читалкой попадает к ошибке, а не остаётся
 * на кнопке отправки. Поля с ошибкой помечены `aria-invalid="true"`.
 */
export function showFormErrors(
  form: HTMLFormElement,
  applyErrors: () => void,
): void {
  flushSync(applyErrors);
  form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
