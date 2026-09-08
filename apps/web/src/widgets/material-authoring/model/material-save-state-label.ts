import type { MaterialSaveState } from "./presentation";

export function materialSaveStateLabel(state: MaterialSaveState): string {
  switch (state.kind) {
    case "clean":
      return "Без изменений";
    case "dirty":
      return "Не сохранено";
    case "submitting":
      return "Сохранение…";
    case "saved":
      return `Сохранено ${state.savedAtLabel}`;
  }
}
