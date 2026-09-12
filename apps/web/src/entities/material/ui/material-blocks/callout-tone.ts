import { calloutToneLabels, type CalloutTone } from "@inside/material-blocks";
import {
  BookMarked,
  CircleCheck,
  CircleX,
  FlaskConical,
  Info,
  Lightbulb,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/** Значок вида. Название вида принадлежит реестру: редактор печатает его в своей разметке. */
const icons: Readonly<Record<CalloutTone, LucideIcon>> = {
  bad: CircleX,
  definition: BookMarked,
  example: FlaskConical,
  good: CircleCheck,
  note: Info,
  tip: Lightbulb,
  warning: TriangleAlert,
};

/** Как вид врезки называется и выглядит: одна запись на вид для читателя и для автора. */
export function calloutTonePresentation(tone: CalloutTone): {
  readonly icon: LucideIcon;
  readonly label: string;
} {
  return { icon: icons[tone], label: calloutToneLabels[tone] };
}

