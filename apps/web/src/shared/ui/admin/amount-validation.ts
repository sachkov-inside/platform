import { formatRubles, parseRublesInput } from "@/shared/lib/moscow-format";

/** Своя ошибка поля суммы: конкретная причина, а не «неверное значение». */
export function amountError(
  text: string,
  {
    min,
    max,
    required,
  }: {
    readonly min: number | undefined;
    readonly max: number | undefined;
    readonly required: boolean;
  },
): string | null {
  if (text.trim() === "") return required ? "Введите сумму" : null;
  const kopecks = parseRublesInput(text);
  if (kopecks === null)
    return "Введите сумму числом, например 4 990 или 1 234,50";
  if (min !== undefined && kopecks < min)
    return `Сумма не может быть меньше ${formatRubles(min)}`;
  if (max !== undefined && kopecks > max)
    return `Сумма не может быть больше ${formatRubles(max)}`;
  return null;
}
