import { left } from "./cycle-left.js";
export function right(): number {
  return left();
}
