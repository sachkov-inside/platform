/** Банк уводит покупателя со страницы: раздел отдаёт переход, а не имитирует его результат. */
export function assignLocation(url: string): void {
  window.location.assign(url);
}
