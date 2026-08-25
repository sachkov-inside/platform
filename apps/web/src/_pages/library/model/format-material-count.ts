export function formatMaterialCount(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  const noun =
    lastTwoDigits >= 11 && lastTwoDigits <= 14
      ? "материалов"
      : lastDigit === 1
        ? "материал"
        : lastDigit >= 2 && lastDigit <= 4
          ? "материала"
          : "материалов";

  return `${String(count)} ${noun}`;
}
