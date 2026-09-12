// Вторая копия словаря прав на стороне браузера: покупатель увидел бы на витрине состав, которого
// сервер не выдаёт. Проверка обязана увидеть и объявление, и строку права, собранную руками.
export function accessComposition(capabilities: readonly string[]): readonly string[] {
  return capabilities.includes("guide:") ? [...capabilities, "community"] : capabilities;
}

export const sample = "guide:5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001";
